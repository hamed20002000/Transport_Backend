/**
 * نوع سفر (داخلی/صادراتی/وارداتی) پیشنهادهای بار و خود بارها از نو، با همان CargoTripTypeService زمان اجرا:
 *
 *   npm run backfill:trip-types
 *
 * برای پیشنهادهای قبل از تشخیص موقع رسیدن، و بعد از هر اصلاح تشخیص (نسخه‌ی اول شهرهای ترکیه با
 * املای فارسی را داخلی حساب می‌کرد). هر جفت مبدأ/مقصد یک بار؛ اسم هر مکان یک بار از مدل پرسیده و
 * در Redis نگه داشته می‌شود، پس اجرای اول چند دقیقه طول می‌کشد و اجرای دوباره سریع است. نوعی که
 * معلوم نشد پاک می‌شود (نه داخلی).
 * برنامه‌ی کامل بالا نمی‌آید تا ربات‌ها و واتساپ کنار سرور در حال اجرا دوباره وصل نشوند.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { CargoTripTypeService } from 'src/services/notification/cargoTripType';
import { RedisService } from 'src/services/redis/redis.service';
import { RoutingService } from 'src/services/routing/routing.service';

async function main(): Promise<void> {
  config();
  const configService = new ConfigService();
  const dataSource = new DataSource({ ...(typeOrmConfig(configService) as DataSourceOptions), entities: [], migrations: [], logging: false });
  await dataSource.initialize();
  const redis = new RedisService(configService);
  const tripTypes = new CargoTripTypeService(new RoutingService(redis, configService), redis);

  try {
    const pairs: { origin: string | null; destination: string | null; count: string }[] = await dataSource.query(
      `SELECT payload->>'origin' AS origin, payload->>'destination' AS destination, COUNT(*) AS count
         FROM "CargoNotification"
        WHERE "listingId" IS NULL
        GROUP BY 1, 2
        ORDER BY COUNT(*) DESC`,
    );
    console.log(`${pairs.length} origin/destination pair(s) to classify`);
    const counts: Record<string, number> = {};

    let done = 0;
    for (const pair of pairs) {
      const tripType = await tripTypes.classify(pair.origin ?? '', pair.destination ?? '');
      await dataSource.query(
        `UPDATE "CargoNotification"
            SET payload = CASE WHEN $3::text IS NULL THEN payload - 'tripType' ELSE payload || jsonb_build_object('tripType', $3::text) END
          WHERE "listingId" IS NULL
            AND payload->>'origin' IS NOT DISTINCT FROM $1 AND payload->>'destination' IS NOT DISTINCT FROM $2`,
        [pair.origin, pair.destination, tripType],
      );
      done++;
      const label = tripType ?? 'UNKNOWN';
      counts[label] = (counts[label] ?? 0) + Number(pair.count);
      console.log(`${done}/${pairs.length} ${label.padEnd(8)} ${pair.origin ?? '-'} → ${pair.destination ?? '-'} (${pair.count})`);
    }
    console.log('suggestions by trip type:', counts);

    // the loads themselves: one saved domestic by an older answer (an Iranian namesake on the map, «چوبان بی» or
    // «پلون») goes abroad, so it reaches the international drivers and asks a border; an unknown answer keeps the type
    const routes: { origin: string; destination: string; tripType: string; count: string }[] = await dataSource.query(
      `SELECT origin, destination, "tripType", COUNT(*) AS count FROM "CargoListing" GROUP BY 1, 2, 3 ORDER BY COUNT(*) DESC`,
    );
    console.log(`${routes.length} load route(s) to check`);
    let changed = 0;
    for (const route of routes) {
      const tripType = await tripTypes.classify(route.origin, route.destination);
      if (!tripType || tripType === route.tripType) continue;
      const result: [unknown[], number] = await dataSource.query(
        `UPDATE "CargoListing" SET "tripType" = $3 WHERE origin = $1 AND destination = $2 AND "tripType" = $4`,
        [route.origin, route.destination, tripType, route.tripType],
      );
      changed += result[1];
      console.log(`${route.tripType} → ${tripType}  ${route.origin} → ${route.destination} (${result[1]})`);
    }
    console.log(`${changed} load(s) changed type`);
  } finally {
    await redis.onModuleDestroy();
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
