/**
 * عکس رسیدهای پرداخت از پوشه‌ی عمومی uploads/payment-receipts به انبار خصوصی
 * (private-uploads/payment-receipts) با اسم تصادفی، و اصلاح imageUrl همان رسیدها:
 *
 *   npm run move:receipts
 *
 * یک بار بعد از این تغییر روی هر سرور. دوباره اجرا کردنش بی‌خطر است (فقط چیزی که هنوز در پوشه‌ی قدیمی
 * مانده جابه‌جا می‌شود). فایلی که هیچ رسیدی به آن اشاره نمی‌کند پاک نمی‌شود، به orphaned می‌رود.
 */
import 'reflect-metadata';
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { LEGACY_PAYMENT_RECEIPT_DIR, receiptDir, storeUnderRandomName } from 'src/services/subscription/receiptStorage';

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Moves the file into the channel's private folder (telegram, bale, …) under a random name. */
function moveToPrivate(file: string, channel: string): string {
  const target = join(receiptDir(channel), basename(file));
  renameSync(file, target);
  return storeUnderRandomName(target);
}

async function main(): Promise<void> {
  config();
  const dataSource = new DataSource({ ...(typeOrmConfig(new ConfigService()) as DataSourceOptions), entities: [], migrations: [], logging: false });
  await dataSource.initialize();
  try {
    const receipts: { id: string; imageUrl: string }[] = await dataSource.query('SELECT id, "imageUrl" FROM "PaymentReceipt"');
    const byPath = new Map(receipts.map((receipt) => [resolve(receipt.imageUrl), receipt.id]));
    let moved = 0;
    let orphaned = 0;

    for (const file of filesUnder(LEGACY_PAYMENT_RECEIPT_DIR)) {
      const receiptId = byPath.get(resolve(file));
      if (receiptId) {
        const target = moveToPrivate(file, basename(dirname(file)));
        await dataSource.query('UPDATE "PaymentReceipt" SET "imageUrl" = $1 WHERE id = $2', [target, receiptId]);
        moved++;
      } else {
        moveToPrivate(file, 'orphaned');
        orphaned++;
      }
    }
    rmSync(LEGACY_PAYMENT_RECEIPT_DIR, { recursive: true, force: true });
    console.log(`Moved ${moved} receipt photo(s) to the private store; ${orphaned} unreferenced file(s) to orphaned.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
