import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { RoutingService } from '../routing/routing.service';

const SWEEP_MS = 5 * 60_000;
// geocoded a sweep at most: the geocoder's own limits, and the cache (routingGeocode) answers repeated places
const SWEEP_BATCH = 40;

interface Pointless {
  id: string;
  origin: string;
  destination: string;
}

/**
 * Where each load's origin and destination are (CargoListing.originLat… / destinationLat…), for «معرفی راننده»
 * (DriverSuggestionService), which finds drivers of routes near a load's. Geocoded once: a load with trips first (its
 * route is the drivers' history), then the newest; a place not found is marked tried (pointsCheckedAt) and left.
 */
@Injectable()
export class CargoPointsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoPointsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly routing: RoutingService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_POINTS_SWEEP', 'true') === 'false') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One load's points now (the load a suggestion is asked for); null where not found. */
  async ensure(listingId: string): Promise<{ origin: Point | null; destination: Point | null } | null> {
    const rows: Array<Pointless & PointColumns> = await this.dataSource.query(
      `SELECT id, origin, destination, "originLat", "originLng", "destinationLat", "destinationLng", "pointsCheckedAt"
         FROM "CargoListing" WHERE id = $1`,
      [listingId],
    );
    const row = rows[0];
    if (!row) return null;
    if (!row.pointsCheckedAt) return this.locate(row);
    return {
      origin: row.originLat !== null && row.originLng !== null ? { lat: row.originLat, lng: row.originLng } : null,
      destination: row.destinationLat !== null && row.destinationLng !== null ? { lat: row.destinationLat, lng: row.destinationLng } : null,
    };
  }

  /** Loads not tried yet, those with trips first; overlapping sweeps are skipped. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows: Pointless[] = await this.dataSource.query(
        `SELECT l.id, l.origin, l.destination FROM "CargoListing" l
          WHERE l."pointsCheckedAt" IS NULL
          ORDER BY EXISTS (SELECT 1 FROM "CargoRequest" r WHERE r."listingId" = l.id AND r.status IN ('ACCEPTED', 'DELIVERED')) DESC,
                   l."createdAt" DESC
          LIMIT $1`,
        [SWEEP_BATCH],
      );
      for (const row of rows) await this.locate(row);
      return rows.length;
    } catch (error) {
      this.logger.warn(`Load points sweep failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async locate(row: Pointless): Promise<{ origin: Point | null; destination: Point | null }> {
    const [origin, destination] = await Promise.all([
      this.routing.geocode(row.origin).catch(() => null),
      this.routing.geocode(row.destination).catch(() => null),
    ]);
    await this.dataSource.query(
      `UPDATE "CargoListing" SET "originLat" = $2, "originLng" = $3, "destinationLat" = $4, "destinationLng" = $5, "pointsCheckedAt" = now()
        WHERE id = $1`,
      [row.id, origin?.lat ?? null, origin?.lng ?? null, destination?.lat ?? null, destination?.lng ?? null],
    );
    return { origin, destination };
  }
}

interface Point {
  lat: number;
  lng: number;
}

interface PointColumns {
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  pointsCheckedAt: Date | null;
}
