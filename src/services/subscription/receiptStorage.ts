import { randomUUID } from 'crypto';
import { mkdirSync, renameSync } from 'fs';
import { extname, join, relative, resolve } from 'path';

/**
 * Payment receipt photos hold names, card digits and bank details: they live outside the publicly served
 * `uploads` folder (like the driver photos) and are shown only through the admin's password-locked endpoint.
 */
export const PAYMENT_RECEIPT_DIR = join(process.cwd(), 'private-uploads', 'payment-receipts');

/** Where receipts used to be saved, publicly served; scripts/movePaymentReceipts.ts moves them out. */
export const LEGACY_PAYMENT_RECEIPT_DIR = join(process.cwd(), 'uploads', 'payment-receipts');

/** The folder for one channel's receipts (web, telegram, bale, rubika), created when missing. */
export function receiptDir(channel: string): string {
  const dir = join(PAYMENT_RECEIPT_DIR, channel.toLowerCase());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Gives a downloaded receipt a name nobody can guess and no other receipt can share: a messenger's own file
 * names (file_0.jpg, file_1.jpg, …) repeat across users and would overwrite each other.
 */
export function storeUnderRandomName(path: string): string {
  const target = join(resolve(path, '..'), `${randomUUID()}${extname(path).toLowerCase() || '.jpg'}`);
  renameSync(path, target);
  return target;
}

/** A path the admin endpoint may serve: inside the private store (or the legacy folder until it is moved). */
export function isStoredReceipt(path: string): boolean {
  const file = resolve(path);
  return [PAYMENT_RECEIPT_DIR, LEGACY_PAYMENT_RECEIPT_DIR].some((dir) => {
    const inside = relative(dir, file);
    return !!inside && !inside.startsWith('..') && !inside.startsWith('/');
  });
}
