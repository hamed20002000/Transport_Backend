import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { CargoRequest } from 'src/domain/entities/notification/CargoRequest';
import { TripFare } from 'src/domain/entities/notification/TripFare';
import { CargoRequestStatus } from 'src/domain/enums/notification';
import { BrokerPayModel, FareChangeReason, TripFareStage } from 'src/domain/enums/tripFare';
import { fareChanged, fareDefaultsFromListing, readTripFare, type TripFareInput, type TripFareValues } from 'src/domain/helper/tripFare';

/** One stage as the panels and the bots show it: numbers, not the bigint strings of the row. */
export interface TripFareView extends TripFareValues {
  stage: TripFareStage;
  enteredAt: Date;
}

/** Both stages of one trip; null where the company has not recorded it (trips from before, or not delivered yet). */
export interface TripFareStages {
  agreed: TripFareView | null;
  delivered: TripFareView | null;
}

/**
 * What the company's form for one stage starts from (web dialog and bot form alike):
 *   values     prefilled: DELIVERED from the agreed values, AGREED from what was recorded before or the load's own
 *              price and weight; parts that cannot be read are left out for the company to fill
 *   agreed     the agreed values, shown above the delivery form to compare
 *   broker     the other party is a broker: at AGREED the company also picks how it is paid (payModel, its last pick)
 */
export interface TripFareForm {
  stage: TripFareStage;
  values: Partial<TripFareInput>;
  agreed: TripFareView | null;
  broker: boolean;
  payModel: BrokerPayModel | null;
}

const STARTED = [CargoRequestStatus.Accepted, CargoRequestStatus.Delivered];

/**
 * The fare and weight of trips at their two stages (TripFare). The rules:
 *   - AGREED is written when the company closes the deal; it may be written again until the trip starts (a request
 *     offered, declined and asked again), never after: those values stay as they were agreed.
 *   - DELIVERED is written when the company confirms the delivery; if its total or weight differs from AGREED, the
 *     reason is required.
 * CargoTripService calls these inside accept / offer / deliver; nothing else writes TripFare.
 */
@Injectable()
export class TripFareService {
  constructor(@InjectRepository(TripFare) private readonly fares: Repository<TripFare>) {}

  /** The values given checked, or a 400 with the reason in Persian. */
  static read(input: Partial<TripFareInput> | null | undefined): TripFareValues {
    const read = readTripFare(input);
    if ('error' in read) throw new BadRequestException(read.error);
    return read.fare;
  }

  async stages(requestId: string): Promise<TripFareStages> {
    return (await this.stagesOf([requestId])).get(requestId) ?? { agreed: null, delivered: null };
  }

  /** Both stages of many trips at once, for lists. */
  async stagesOf(requestIds: string[]): Promise<Map<string, TripFareStages>> {
    const result = new Map<string, TripFareStages>();
    if (!requestIds.length) return result;
    for (const row of await this.fares.find({ where: { requestId: In(requestIds) } })) {
      const entry = result.get(row.requestId) ?? { agreed: null, delivered: null };
      entry[row.stage === TripFareStage.Agreed ? 'agreed' : 'delivered'] = TripFareService.view(row);
      result.set(row.requestId, entry);
    }
    return result;
  }

  /** The starting point of the company's form for this trip and stage (see TripFareForm). */
  async form(request: CargoRequest, stage: TripFareStage): Promise<TripFareForm> {
    const { agreed, delivered } = await this.stages(request.id);
    const broker = !!request.forDriver;
    const fromListing = fareDefaultsFromListing(request.listing);
    const recorded = stage === TripFareStage.Delivered ? (delivered ?? agreed) : agreed;
    const values: Partial<TripFareInput> = recorded
      ? { basis: recorded.basis, rate: recorded.rate, weightTons: recorded.weightTons, currency: recorded.currency }
      : fromListing;
    const payModel = broker && stage === TripFareStage.Agreed ? (request.brokerPayModel ?? (await this.lastPayModel(request.companyUserId))) : null;
    return { stage, values, agreed: stage === TripFareStage.Delivered ? agreed : null, broker, payModel };
  }

  /**
   * The company's agreed values for a trip that is about to start (accept, or an offer to a driver).
   * 409 fareLocked once the trip has started: what was agreed is not rewritten.
   */
  async recordAgreed(request: CargoRequest, values: TripFareValues, userId: string): Promise<TripFareView> {
    if (STARTED.includes(request.status) && (await this.fares.exists({ where: { requestId: request.id, stage: TripFareStage.Agreed } }))) {
      throw new ConflictException('fareLocked');
    }
    return this.upsert(request.id, TripFareStage.Agreed, { ...values, changeReason: null }, userId);
  }

  /**
   * The company's values at delivery. When they differ from the agreed ones the reason is required (400); when they
   * do not, any reason given is dropped, so «changed» always means a real change.
   */
  async recordDelivered(request: CargoRequest, values: TripFareValues, userId: string): Promise<TripFareView> {
    const agreed = (await this.stages(request.id)).agreed;
    const changed = !!agreed && fareChanged(agreed, values);
    if (changed && !values.changeReason) throw new BadRequestException('کرایه یا وزن با مقدار توافقی فرق دارد؛ دلیل تغییر را انتخاب کنید.');
    const changeReason: FareChangeReason | null = changed ? values.changeReason : null;
    return this.upsert(request.id, TripFareStage.Delivered, { ...values, changeReason }, userId);
  }

  /** How this company paid the broker of its last broker trip: the default of its next one (COMMISSION at first). */
  async lastPayModel(companyUserId: string): Promise<BrokerPayModel> {
    const last = await this.fares.manager.getRepository(CargoRequest).findOne({
      where: { companyUserId, brokerPayModel: Not(IsNull()) },
      order: { decidedAt: 'DESC' },
      select: { id: true, brokerPayModel: true },
    });
    return last?.brokerPayModel ?? BrokerPayModel.Commission;
  }

  private async upsert(requestId: string, stage: TripFareStage, values: TripFareValues, userId: string): Promise<TripFareView> {
    const row = (await this.fares.findOne({ where: { requestId, stage } })) ?? this.fares.create({ requestId, stage });
    Object.assign(row, {
      basis: values.basis,
      rate: String(values.rate),
      weightTons: values.weightTons.toFixed(2),
      total: String(values.total),
      currency: values.currency,
      changeReason: values.changeReason,
      note: values.note,
      enteredByUserId: userId,
    });
    return TripFareService.view(await this.fares.save(row));
  }

  private static view(row: TripFare): TripFareView {
    return {
      stage: row.stage,
      basis: row.basis,
      rate: Number(row.rate),
      weightTons: Number(row.weightTons),
      total: Number(row.total),
      currency: row.currency,
      changeReason: row.changeReason ?? null,
      note: row.note ?? null,
      enteredAt: row.updatedAt ?? row.createdAt,
    };
  }
}
