import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { fa } from 'src/application/services/agent/tools/toolKit';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { BrokerPayModel, FareBasis, FareChangeReason, TripFareStage } from 'src/domain/enums/tripFare';
import {
  BROKER_PAY_MODEL_LABEL,
  FARE_CHANGE_REASON_LABEL,
  faNumber,
  fareChanged,
  fareLine,
  moneyText,
  moneyWords,
  readAmount,
  readTripFare,
  readWeight,
  WEIGHT_UNIT_LABEL,
  type TripFareInput,
  type TripFareValues,
  type WeightUnit,
} from 'src/domain/helper/tripFare';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { BotRows as Rows } from '../messengerBot/core/botRows';
import { RedisService } from '../redis/redis.service';
import { CargoTripService, OFFER_TTL_MINUTES } from './cargoTrip.service';
import { TripFareForm } from './tripFare.service';

const PREFIX = 'tf:';
const Action = {
  Basis: `${PREFIX}b:`, // + FareBasis
  // the value shown on the button for the current step (the agreed one, or the load's own)
  Keep: `${PREFIX}k`,
  Reason: `${PREFIX}r:`, // + FareChangeReason
  Pay: `${PREFIX}p:`, // + BrokerPayModel
  Unit: `${PREFIX}u:`, // + WeightUnit: the unit the weight is typed in
  // delivery: nothing changed, the agreed values are the final ones
  Same: `${PREFIX}same`,
  Change: `${PREFIX}chg`,
  Save: `${PREFIX}ok`,
  Edit: `${PREFIX}ed`,
  Cancel: `${PREFIX}x`,
} as const;

const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel'];
const SESSION_TTL_SECONDS = 30 * 60;

/** What the form is for: what «ثبت» does at the end, and where the user goes back to. */
type FarePurpose =
  | { kind: 'accept'; requestId: string }
  | { kind: 'deliver'; requestId: string }
  | { kind: 'offer'; listingId: string; driverUserId: string; driverName: string; back: BotAction };

type FareStep = 'review' | 'basis' | 'rate' | 'weight' | 'reason' | 'pay' | 'confirm';

interface FareSession {
  purpose: FarePurpose;
  cargo: string;
  step: FareStep;
  /** what the company gave so far */
  values: Partial<TripFareInput>;
  /** the prefilled values (TripFareForm.values), offered as «همان …» buttons */
  defaults: Partial<TripFareInput>;
  agreed: TripFareValues | null;
  broker: boolean;
  payModel: BrokerPayModel | null;
  /** the unit the company types the weight in; tons until it picks kilograms */
  weightUnit?: WeightUnit;
}

/**
 * The company's fare form in the bots and WhatsApp (both go through BotDialogRegistry, so they ask the same steps;
 * WhatsApp shows the buttons as numbered items). One form for the three moments the company records a trip's fare
 * (TripFare): accepting a request, handing a load to a driver (AGREED), confirming a delivery (DELIVERED).
 *
 *   accept / offer:  basis → amount → weight → (a broker's request: how it is paid) → confirm
 *   deliver:         the agreed values with «بدون تغییر» (done) or «فرق کرد» → basis → amount → weight
 *                    → (changed: the reason) → confirm
 *
 * Every step shows what was prefilled as a one-tap button. «ثبت» calls CargoTripService, which checks everything
 * again; the rules live there and in TripFareService, here only the questions.
 */
@Injectable()
export class TripFareDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(TripFareDialog.name);
  readonly entries: Record<string, string> = {};

  constructor(
    private readonly trips: CargoTripService,
    private readonly registry: BotDialogRegistry,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return !!(await this.getSession(ctx));
  }

  //#region ----------- Starting points ----------------------------------------

  /** «قبول» of a request: the agreed fare first. */
  async startAccept(ctx: BotContext, requestId: string): Promise<BotReply> {
    return this.start(ctx, { kind: 'accept', requestId }, () => this.trips.fareForm(ctx.userId, requestId, TripFareStage.Agreed), requestId);
  }

  /** The company confirms (or records) a delivery: the final fare, starting from the agreed one. */
  async startDeliver(ctx: BotContext, requestId: string): Promise<BotReply> {
    return this.start(ctx, { kind: 'deliver', requestId }, () => this.trips.fareForm(ctx.userId, requestId, TripFareStage.Delivered), requestId);
  }

  /** A load handed to a driver: the agreed fare, from the load's own price and weight. `back`: the list it came from. */
  async startOffer(ctx: BotContext, listingId: string, driver: { userId: string; name: string }, back: BotAction): Promise<BotReply> {
    const purpose: FarePurpose = { kind: 'offer', listingId, driverUserId: driver.userId, driverName: driver.name, back };
    return this.start(ctx, purpose, () => this.trips.offerFareForm(ctx.userId, listingId), null, listingId);
  }

  private async start(ctx: BotContext, purpose: FarePurpose, load: () => Promise<TripFareForm>, requestId: string | null, listingId?: string): Promise<BotReply> {
    let form: TripFareForm;
    let cargo = '';
    try {
      form = await load();
      if (requestId) {
        const request = await this.trips.forCompany(ctx.userId, requestId);
        cargo = request ? this.trips.cargoTitle(request) : '';
      } else if (listingId) {
        cargo = (await this.trips.listingTitle(listingId)) ?? '';
      }
    } catch (error) {
      return this.finish(ctx, purpose, this.errorText(error));
    }
    const agreed = form.agreed;
    const session: FareSession = {
      purpose,
      cargo,
      step: purpose.kind === 'deliver' && agreed ? 'review' : 'basis',
      values: {},
      defaults: form.values,
      agreed,
      broker: form.broker,
      payModel: form.payModel,
    };
    await this.saveSession(ctx, session);
    return this.ask(session, purpose.kind === 'deliver' && !agreed ? this.t('noAgreed') : undefined);
  }

  //#endregion

  //#region ----------- Answers ------------------------------------------------

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    const session = await this.getSession(ctx);
    if (!session) return { text: this.t('expired'), actions: [{ id: `${TripAction.CompanyRequests}1`, label: this.tt('actions.allRequests') }] };
    const arg = (prefix: string) => id.slice(prefix.length);

    if (id === Action.Cancel) return this.finish(ctx, session.purpose, this.t('cancelled'));
    if (id === Action.Edit || id === Action.Change) return this.next(ctx, { ...session, step: 'basis', values: {} });
    if (id === Action.Same && session.agreed) {
      const { basis, rate, weightTons, currency } = session.agreed;
      return this.save(ctx, { ...session, values: { basis, rate, weightTons, currency } });
    }
    if (id === Action.Save) return this.save(ctx, session);

    if (id.startsWith(Action.Basis) && session.step === 'basis') {
      const basis = arg(Action.Basis) as FareBasis;
      if (!Object.values(FareBasis).includes(basis)) return this.ask(session);
      return this.next(ctx, { ...session, step: 'rate', values: { ...session.values, basis } });
    }
    if (id === Action.Keep) {
      const keep = this.keepValue(session);
      if (keep === null) return this.ask(session);
      if (session.step === 'rate') return this.afterRate(ctx, session, { amount: keep, currency: session.defaults.currency });
      if (session.step === 'weight') return this.afterWeight(ctx, session, keep);
    }
    if (id.startsWith(Action.Unit) && session.step === 'weight') {
      const unit = arg(Action.Unit) as WeightUnit;
      if (!(unit in WEIGHT_UNIT_LABEL)) return this.ask(session);
      return this.next(ctx, { ...session, weightUnit: unit });
    }
    if (id.startsWith(Action.Reason) && session.step === 'reason') {
      const reason = arg(Action.Reason) as FareChangeReason;
      if (!Object.values(FareChangeReason).includes(reason)) return this.ask(session);
      return this.next(ctx, { ...session, step: 'confirm', values: { ...session.values, changeReason: reason } });
    }
    if (id.startsWith(Action.Pay) && session.step === 'pay') {
      const model = arg(Action.Pay) as BrokerPayModel;
      if (!Object.values(BrokerPayModel).includes(model)) return this.ask(session);
      return this.next(ctx, { ...session, step: 'confirm', payModel: model });
    }
    return this.ask(session);
  }

  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (!session) return null;
    if (CANCEL_WORDS.includes(text.trim())) return this.finish(ctx, session.purpose, this.t('cancelled'));
    if (session.step === 'rate') {
      const amount = readAmount(text);
      return amount ? this.afterRate(ctx, session, amount) : this.ask(session, this.t('badRate'));
    }
    if (session.step === 'weight') {
      const tons = readWeight(text, session.weightUnit ?? 'TON');
      return tons ? this.afterWeight(ctx, session, tons) : this.ask(session, this.t('badWeight'));
    }
    // a step answered with buttons: show it again
    return this.ask(session);
  }

  private afterRate(ctx: BotContext, session: FareSession, amount: { amount: number; currency?: TripFareInput['currency'] }): Promise<BotReply> {
    return this.next(ctx, { ...session, step: 'weight', values: { ...session.values, rate: amount.amount, currency: amount.currency } });
  }

  /** After the weight: the reason when the delivery changed something, how a broker is paid, or the summary. */
  private afterWeight(ctx: BotContext, session: FareSession, weightTons: number): Promise<BotReply> {
    const values = { ...session.values, weightTons };
    const read = readTripFare(values);
    const changed = session.purpose.kind === 'deliver' && !!session.agreed && 'fare' in read && fareChanged(session.agreed, read.fare);
    const step: FareStep = changed ? 'reason' : session.purpose.kind === 'accept' && session.broker ? 'pay' : 'confirm';
    return this.next(ctx, { ...session, step, values: { ...values, changeReason: changed ? values.changeReason : undefined } });
  }

  private async next(ctx: BotContext, session: FareSession): Promise<BotReply> {
    await this.saveSession(ctx, session);
    return this.ask(session);
  }

  //#endregion

  //#region ----------- Questions ----------------------------------------------

  private ask(session: FareSession, problem?: string): BotReply {
    const { purpose, step } = session;
    const rows = new Rows();
    let question: string;
    switch (step) {
      case 'review':
        question = this.t('review', { agreed: fareLine(session.agreed!) });
        rows.add({ id: Action.Same, label: this.t('actions.same') }).add({ id: Action.Change, label: this.t('actions.changed') });
        break;
      case 'basis':
        question = this.t('askBasis');
        rows.add({ id: `${Action.Basis}${FareBasis.Total}`, label: this.t('actions.total') }, { id: `${Action.Basis}${FareBasis.PerTon}`, label: this.t('actions.perTon') });
        break;
      case 'rate':
        question = this.t(session.values.basis === FareBasis.PerTon ? 'askRatePerTon' : 'askRateTotal');
        break;
      case 'weight': {
        // tons by default; the other unit one tap away, the chosen one marked
        const unit = session.weightUnit ?? 'TON';
        question = this.t(`${purpose.kind === 'deliver' ? 'askWeightDeliver' : 'askWeight'}${unit === 'KG' ? 'Kg' : ''}`);
        rows.add(
          ...(Object.keys(WEIGHT_UNIT_LABEL) as WeightUnit[]).map((option) => ({
            id: `${Action.Unit}${option}`,
            label: `${option === unit ? '● ' : ''}${WEIGHT_UNIT_LABEL[option]}`,
          })),
        );
        break;
      }
      case 'reason': {
        const final = readTripFare(session.values);
        question = this.t('askReason', { agreed: fareLine(session.agreed!), final: 'fare' in final ? fareLine(final.fare) : '' });
        rows.grid(Object.values(FareChangeReason).map((reason) => ({ id: `${Action.Reason}${reason}`, label: FARE_CHANGE_REASON_LABEL[reason] })));
        break;
      }
      case 'pay':
        question = this.t('askPay');
        rows.add(
          ...Object.values(BrokerPayModel).map((model) => ({
            id: `${Action.Pay}${model}`,
            label: `${model === session.payModel ? '● ' : ''}${BROKER_PAY_MODEL_LABEL[model]}`,
          })),
        );
        break;
      case 'confirm':
        return this.summary(session, problem);
    }
    const keep = this.keepValue(session);
    if (keep !== null) {
      const label = step === 'weight' ? this.t('actions.keepWeight', { value: faNumber(keep) }) : this.t('actions.keepRate', { value: moneyText(keep, session.defaults.currency) });
      rows.add({ id: Action.Keep, label });
    }
    rows.add({ id: Action.Cancel, label: this.t('actions.cancel') });
    return { text: [problem, this.title(session), this.stepLine(session), question].filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  /** The values once more, with the amount in words (a missing zero shows), and «ثبت». */
  private summary(session: FareSession, problem?: string): BotReply {
    const read = readTripFare(session.values);
    if ('error' in read) return this.ask({ ...session, step: 'basis' }, read.error);
    const fare = read.fare;
    const lines = [
      this.t('confirm', { line: fareLine(fare), words: moneyWords(fare.total, fare.currency) }),
      fare.changeReason ? this.t('confirmReason', { reason: FARE_CHANGE_REASON_LABEL[fare.changeReason] }) : '',
      session.purpose.kind === 'accept' && session.broker && session.payModel ? this.t('confirmPay', { model: BROKER_PAY_MODEL_LABEL[session.payModel] }) : '',
    ];
    const save = { accept: 'actions.saveAccept', offer: 'actions.saveOffer', deliver: 'actions.saveDeliver' }[session.purpose.kind];
    return {
      text: [problem, this.title(session), lines.filter(Boolean).join('\n')].filter(Boolean).join('\n\n'),
      actions: new Rows()
        .add({ id: Action.Save, label: this.t(save) })
        .add({ id: Action.Edit, label: this.t('actions.edit') }, { id: Action.Cancel, label: this.t('actions.cancel') }).actions,
    };
  }

  /**
   * The prefilled value of a text step, if it fits: the amount only for the same basis it was given in (a whole fare
   * is no per-ton fare).
   */
  private keepValue(session: FareSession): number | null {
    const { defaults, values, step } = session;
    if (step === 'rate') return defaults.rate && defaults.basis === values.basis ? defaults.rate : null;
    if (step === 'weight') return defaults.weightTons ?? null;
    return null;
  }

  private title(session: FareSession): string {
    const { purpose, cargo } = session;
    if (purpose.kind === 'offer') return this.t('titleOffer', { driver: purpose.driverName, cargo });
    return this.t(purpose.kind === 'accept' ? 'titleAccept' : 'titleDeliver', { cargo });
  }

  /** «(مرحله‌ی ۲ از ۴)» for the questions in a row; none for the delivery's first look. */
  private stepLine(session: FareSession): string {
    const steps: FareStep[] = ['basis', 'rate', 'weight'];
    if (session.purpose.kind === 'deliver' && session.agreed) steps.push('reason');
    if (session.purpose.kind === 'accept' && session.broker) steps.push('pay');
    const index = steps.indexOf(session.step);
    return index < 0 ? '' : this.t('step', { step: fa(index + 1), steps: fa(steps.length) });
  }

  //#endregion

  //#region ----------- Saving -------------------------------------------------

  private async save(ctx: BotContext, session: FareSession): Promise<BotReply> {
    const read = readTripFare(session.values);
    if ('error' in read) return this.next(ctx, { ...session, step: 'basis', values: {} });
    const fare = { ...read.fare, changeReason: read.fare.changeReason ?? undefined };
    const { purpose } = session;
    try {
      if (purpose.kind === 'accept') {
        const request = await this.trips.decide(ctx.userId, purpose.requestId, true, { fare, payModel: session.payModel });
        return this.finish(ctx, purpose, this.tt('decision.accepted', { cargo: this.trips.cargoTitle(request) }));
      }
      if (purpose.kind === 'deliver') {
        const request = await this.trips.deliver(ctx.userId, purpose.requestId, fare);
        return this.finish(ctx, purpose, this.tt('delivered.done', { cargo: this.trips.cargoTitle(request) }));
      }
      await this.trips.offer(ctx.userId, purpose.listingId, purpose.driverUserId, fare);
      return this.finish(ctx, purpose, this.i18n.translate('cargo.assign.offered', { lang: 'fa', args: { name: purpose.driverName, minutes: fa(OFFER_TTL_MINUTES) } }) as string);
    } catch (error) {
      // the values were refused (400): the summary again with the reason; anything else ends the form
      if (error instanceof BadRequestException) return this.summary(session, error.message);
      return this.finish(ctx, purpose, this.errorText(error));
    }
  }

  /** The form is over (saved, cancelled or failed): the list it came from. */
  private async finish(ctx: BotContext, purpose: FarePurpose, text: string): Promise<BotReply> {
    await this.clearSession(ctx);
    const actions: BotAction[] =
      purpose.kind === 'offer'
        ? [purpose.back]
        : purpose.kind === 'accept'
          ? [
              { id: `${TripAction.CompanyRequests}1`, label: this.tt('actions.allRequests'), row: 0 },
              { id: `${TripAction.CompanyTrips}1`, label: this.tt('actions.companyTrips'), row: 0 },
            ]
          : [{ id: `${TripAction.CompanyTrips}1`, label: this.tt('actions.companyTrips') }];
    return { text, actions };
  }

  private errorText(error: unknown): string {
    if (error instanceof ConflictException) return this.tt(`errors.${error.message}`);
    if (error instanceof BadRequestException) return error.message;
    this.logger.warn(`Trip fare form failed: ${(error as Error).message}`);
    return this.tt('notFound');
  }

  //#endregion

  //#region ----------- Helpers ------------------------------------------------

  private t(key: string, args?: Record<string, string | number>): string {
    return this.tt(`fare.${key}`, args);
  }

  private tt(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('tripFareDialog', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<FareSession | null> {
    return this.redis.getJson<FareSession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: FareSession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }

  //#endregion
}

