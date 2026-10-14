import { createHash } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DriverProfile, DriverVerificationRecord, VerificationAnswer } from 'src/domain/entities/driver/DriverProfile';
import { UserProfile, UserService } from '../UserService';
import { ApiIrClient, ApiIrResult, DrivingLicenseInfo, DrivingScoreInfo, PersonInfo } from './apiIr.client';

export const VERIFICATION_CHECKS = ['shahkar', 'person', 'license', 'score'] as const;
export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

/**
 * passed/failed: نتیجه‌ی استعلام برای مدارک فعلی؛ missing: مدرک لازم وارد نشده؛
 * pending: هنوز استعلام نشده، مدرک عوض شده یا منتظر استعلام قبلی (شاهکار) است.
 */
export type VerificationStatus = 'passed' | 'failed' | 'missing' | 'pending';

export interface VerificationCheckView {
  status: VerificationStatus;
  message?: string;
  checkedAt?: string;
  details?: Record<string, unknown>;
}

export interface DriverVerificationView {
  // شاهکار، ثبت احوال و گواهینامه هر سه تأیید شده‌اند (نمره‌ی منفی فقط اطلاع است)
  verified: boolean;
  checks: Record<VerificationCheck, VerificationCheckView>;
}

type DriverDocuments = Pick<DriverProfile, 'birthDate' | 'licenseNumber' | 'verification'> | null | undefined;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// پاسخ موفق تا این مدت معتبر است (سیم‌کارت جابه‌جا می‌شود، گواهینامه باطل یا نمره‌اش عوض می‌شود)
const PASSED_MAX_AGE: Record<VerificationCheck, number> = {
  shahkar: 180 * DAY,
  person: Number.POSITIVE_INFINITY,
  license: 30 * DAY,
  score: 7 * DAY,
};
// پاسخ ناموفق با همان ورودی‌ها تا یک ساعت دوباره پرسیده نمی‌شود
const FAILED_RETRY_AFTER = HOUR;
const DAILY_PAID_INQUIRIES = 12;

const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

function normalizeMobile(mobile?: string | null): string | null {
  const digits = toLatinDigits(mobile ?? '').replace(/\D/g, '');
  return /^(0|98|0098)?9\d{9}$/.test(digits) ? `0${digits.slice(-10)}` : null;
}

// ثبت احوال «1370/1/1» می‌خواهد؛ «1370/01/01» هم پذیرفته و یکسان می‌شود
function normalizeBirthDate(date?: string | null): string | null {
  const match = /^(1[34]\d{2})\/(\d{1,2})\/(\d{1,2})$/.exec(toLatinDigits(date ?? '').trim());
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : null;
}

// ی/ک عربی، نیم‌فاصله، کشیده و فاصله در مقایسه‌ی نام اثری ندارند
const normalizeName = (name?: string | null) =>
  (name ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌ـ]/g, '').toLowerCase();

const inputKey = (inputs: string[]) => createHash('sha256').update(inputs.join('|')).digest('hex').slice(0, 16);

/** ورودی‌های هر استعلام از روی پروفایل فعلی؛ null یعنی مدرک لازم وارد نشده. */
function checkInputs(user: UserProfile, driver: DriverDocuments): Record<VerificationCheck, string[] | null> {
  const nationalCode = /^\d{10}$/.test(user.nationalCode ?? '') ? user.nationalCode! : null;
  const mobile = normalizeMobile(user.mobile);
  const birthDate = normalizeBirthDate(driver?.birthDate);
  const licenseNumber = driver?.licenseNumber?.trim() || null;
  return {
    shahkar: nationalCode && mobile ? [nationalCode, mobile] : null,
    person: nationalCode && birthDate ? [nationalCode, birthDate] : null,
    license: nationalCode && mobile ? [nationalCode, mobile] : null,
    score: nationalCode && mobile && licenseNumber ? [nationalCode, mobile, licenseNumber] : null,
  };
}

const MISSING_MESSAGE: Record<VerificationCheck, string> = {
  shahkar: 'کد ملی و موبایل لازم است.',
  person: 'کد ملی و تاریخ تولد لازم است.',
  license: 'کد ملی و موبایل لازم است.',
  score: 'کد ملی، موبایل و شماره گواهینامه لازم است.',
};

function judge(check: VerificationCheck, answer: VerificationAnswer, user: UserProfile, driver: DriverDocuments): VerificationCheckView {
  const base = { checkedAt: answer.checkedAt };
  const rejected = (message: string) => ({ ...base, status: 'failed' as const, message: answer.message || message });
  if (!answer.ok) return rejected('استعلام ناموفق بود.');

  switch (check) {
    case 'shahkar':
      return answer.data === true
        ? { ...base, status: 'passed' }
        : { ...base, status: 'failed', message: 'این موبایل به نام این کد ملی ثبت نشده است.' };
    case 'person': {
      const person = (answer.data ?? {}) as PersonInfo;
      const details = { firstName: person.firstName ?? null, lastName: person.lastName ?? null, fatherName: person.fatherName ?? null };
      if (person.alive === false) return { ...base, status: 'failed', message: 'ثبت احوال این شخص را در قید حیات نمی‌داند.', details };
      if (normalizeName(person.firstName) !== normalizeName(user.firstName) || normalizeName(person.lastName) !== normalizeName(user.lastName)) {
        return { ...base, status: 'failed', message: 'نام و نام خانوادگی با ثبت احوال یکی نیست.', details };
      }
      return { ...base, status: 'passed', details };
    }
    case 'license': {
      const licenses = ((answer.data as { licenses?: DrivingLicenseInfo[] | null })?.licenses ?? []).map((license) => ({
        licenseNumber: license.licenseNumber ?? null,
        licenseType: license.licenseType ?? null,
        licenseStatus: license.licenseStatus ?? null,
        issueDate: license.issueDate ?? null,
        validityYears: license.validityYears ?? null,
      }));
      if (!licenses.length) return { ...base, status: 'failed', message: 'گواهینامه‌ای به نام این کد ملی پیدا نشد.' };
      const number = driver?.licenseNumber?.trim();
      if (number && !licenses.some((license) => license.licenseNumber === number)) {
        return { ...base, status: 'failed', message: 'شماره گواهینامه با گواهینامه‌های ثبت‌شده یکی نیست.', details: { licenses } };
      }
      return { ...base, status: 'passed', details: { licenses } };
    }
    case 'score': {
      const score = (answer.data ?? {}) as DrivingScoreInfo;
      return {
        ...base,
        status: 'passed',
        details: { negativeScore: score.negativeScore ?? null, offenseCount: score.offenseCount ?? null, rule: score.rule ?? null },
      };
    }
  }
}

/** وضعیت تأیید راننده از روی پاسخ‌های ذخیره‌شده و مدارک فعلی؛ استعلام جدیدی نمی‌زند. */
export function evaluateVerification(user: UserProfile, driver: DriverDocuments): DriverVerificationView {
  const inputs = checkInputs(user, driver);
  const answers = driver?.verification?.answers ?? {};
  const checks = {} as Record<VerificationCheck, VerificationCheckView>;
  for (const check of VERIFICATION_CHECKS) {
    const input = inputs[check];
    const answer = answers[check];
    if (!input) checks[check] = { status: 'missing', message: MISSING_MESSAGE[check] };
    else if (!answer || answer.inputKey !== inputKey(input)) checks[check] = { status: 'pending' };
    else checks[check] = judge(check, answer, user, driver);
  }
  // گواهینامه و نمره با موبایل استعلام می‌شوند؛ بدون شاهکار نتیجه‌شان معتبر نیست
  if (checks.shahkar.status !== 'passed') {
    for (const check of ['license', 'score'] as const) {
      if (checks[check].status !== 'missing') checks[check] = { status: 'pending', message: 'اول باید موبایل به نام کد ملی تأیید شود.' };
    }
  }
  return {
    verified: checks.shahkar.status === 'passed' && checks.person.status === 'passed' && checks.license.status === 'passed',
    checks,
  };
}

/**
 * تأیید مدارک راننده با api.ir: شاهکار (موبایل ↔ کد ملی)، ثبت احوال (نام و تاریخ تولد)،
 * گواهینامه و نمره‌ی منفی. هر استعلام پولی است: پاسخ‌ها با هش ورودی ذخیره می‌شوند و
 * تا مدرک عوض نشده یا پاسخ کهنه نشده دوباره پرسیده نمی‌شوند.
 */
@Injectable()
export class DriverVerificationService {
  constructor(
    @InjectRepository(DriverProfile) private readonly profiles: Repository<DriverProfile>,
    private readonly users: UserService,
    private readonly apiIr: ApiIrClient,
  ) {}

  async status(userId: string): Promise<DriverVerificationView> {
    const [user, driver] = await Promise.all([this.users.getProfile(userId), this.profiles.findOne({ where: { userId } })]);
    return evaluateVerification(user, driver);
  }

  async verify(userId: string): Promise<DriverVerificationView> {
    const [user, existing] = await Promise.all([this.users.getProfile(userId), this.profiles.findOne({ where: { userId } })]);
    const driver = existing ?? this.profiles.create({ userId });
    const record: DriverVerificationRecord = { answers: { ...driver.verification?.answers }, usage: driver.verification?.usage };
    const inputs = checkInputs(user, driver);

    const refresh = async <T>(check: VerificationCheck, call: (input: string[]) => Promise<ApiIrResult<T>>) => {
      const input = inputs[check];
      if (!input) return;
      const key = inputKey(input);
      const previous = record.answers[check];
      if (previous?.inputKey === key) {
        const age = Date.now() - Date.parse(previous.checkedAt);
        if (age < (previous.ok ? PASSED_MAX_AGE[check] : FAILED_RETRY_AFTER)) return;
      }
      this.spendQuota(record);
      const result = await call(input);
      record.answers[check] = {
        inputKey: key,
        checkedAt: new Date().toISOString(),
        ok: result.success,
        message: result.message ?? null,
        data: result.data ?? null,
      };
      // هر پاسخ پولی همان لحظه ذخیره می‌شود، حتی اگر استعلام بعدی خطا بدهد
      driver.verification = { ...record, answers: { ...record.answers } };
      await this.profiles.save(driver);
    };
    const current = () => evaluateVerification(user, { ...driver, verification: record });

    await refresh('shahkar', ([nationalCode, mobile]) => this.apiIr.shahkar(nationalCode, mobile));
    await refresh('person', ([nationalCode, birthDate]) => this.apiIr.personInfo(nationalCode, birthDate));
    if (current().checks.shahkar.status === 'passed') {
      await refresh('license', ([nationalCode, mobile]) => this.apiIr.drivingLicense(nationalCode, mobile));
    }
    if (current().checks.license.status === 'passed') {
      await refresh('score', ([nationalCode, mobile, licenseNumber]) => this.apiIr.drivingScore(nationalCode, mobile, licenseNumber));
    }
    return current();
  }

  private spendQuota(record: DriverVerificationRecord) {
    const day = new Date().toISOString().slice(0, 10);
    const count = record.usage?.day === day ? record.usage.count : 0;
    if (count >= DAILY_PAID_INQUIRIES) {
      throw new HttpException('Too many identity inquiries today. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
    }
    record.usage = { day, count: count + 1 };
  }
}
