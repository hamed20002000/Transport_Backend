import { textParam, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { normalizePersianText } from '../../domain/helper/persianText';
import { CargoRouteFields } from './cargoAlertFilter.service';

/**
 * جستجوی لحظه‌ای در لیست بارها (مثلاً «لیست بارهای کارتن از تهران» در agent)؛
 * هر فیلد اگر آمده باشد باید در همان فیلد بار «وجود داشته باشد»، مثل فیلترهای اعلان.
 */
export interface CargoSearch {
  origin?: string;
  destination?: string;
  cargoType?: string;
  vehicleType?: string;
}

const FIELDS = ['origin', 'destination', 'cargoType', 'vehicleType'] as const;

/** فقط فیلدهای پرشده، یکسان‌شده؛ null یعنی جستجویی در کار نیست. */
export function prepareCargoSearch(search: CargoSearch): CargoSearch | null {
  const prepared: CargoSearch = {};
  for (const field of FIELDS) {
    const value = search[field] ? normalizePersianText(search[field]!) : '';
    if (value) prepared[field] = value;
  }
  return Object.keys(prepared).length ? prepared : null;
}

/** search باید خروجی prepareCargoSearch باشد. */
export function matchesCargoSearch(cargo: CargoRouteFields, search: CargoSearch): boolean {
  return FIELDS.every((field) => !search[field] || normalizePersianText(cargo[field] ?? '').includes(search[field]!));
}

/** شرط‌های جستجو برای متن جواب: « کارتن از تهران به کرج با تریلی» */
export function cargoSearchText(search: CargoSearch): string {
  const { cargoType, origin, destination, vehicleType } = search;
  return [
    cargoType && ` ${cargoType}`,
    origin && ` از ${origin}`,
    destination && ` به ${destination}`,
    vehicleType && ` با ${vehicleType}`,
  ]
    .filter(Boolean)
    .join('');
}

/** شرط‌های جستجو از پارامترهای ابزار agent (origin، destination، cargoType، vehicleType). */
export function searchFromParams(param: ToolParam): CargoSearch {
  return {
    origin: textParam(param.origin),
    destination: textParam(param.destination),
    cargoType: textParam(param.cargoType),
    vehicleType: textParam(param.vehicleType),
  };
}
