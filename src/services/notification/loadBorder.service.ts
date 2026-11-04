import { Injectable } from '@nestjs/common';

import { CargoListing } from 'src/domain/entities/notification/CargoListing';
import { CargoTripType } from 'src/domain/enums/notification';
import { bordersToward, EXIT_BORDERS, exitBordersOnRoute } from '../border/exitBorders';
import { decodePolyline, GeoPoint } from '../routing/geo';
import { RoutingService } from '../routing/routing.service';
import { CargoTripTypeService, latinSide } from './cargoTripType';

const MAX_CHOICES = 6;

/** The border a request goes by: asked of an export or import load, offered from where the load goes abroad. */
export interface LoadBorderChoice {
  /** false for a domestic load: no border is asked */
  needed: boolean;
  /** «مرز خروج» for an export load, «مرز ورود» for an import one */
  label: string;
  /** the borders toward the place abroad, nearest first */
  options: string[];
}

const compact = (text: string) => text.replace(/[\s‌\-]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

/**
 * Which border a driver or broker requesting a load crosses by: the borders to the country the load goes to (an
 * export load's destination, an import load's origin), chosen in a list on every channel (web modal, messenger
 * buttons, the assistant's selection) and kept with the request (CargoRequest.exitBorder).
 */
@Injectable()
export class LoadBorderService {
  constructor(
    private readonly routing: RoutingService,
    private readonly tripTypes: CargoTripTypeService,
  ) {}

  async choices(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>): Promise<LoadBorderChoice> {
    const tripType = await this.tripTypeOf(listing);
    if (tripType === CargoTripType.Domestic) return { needed: false, label: '', options: [] };
    const exportLoad = tripType === CargoTripType.Export;
    const { origin, destination } = await this.points(listing);
    // first the borders the load's own routes cross (Yerevan: Norduz, though Bazargan is nearer as the crow flies),
    // then those toward the place abroad (where the load goes, or comes from) for a route that crosses none known
    const crossed = origin && destination ? await this.crossed(origin, destination) : [];
    const toward = bordersToward(exportLoad ? destination : origin).map((border) => border.name);
    const options = [...new Set([...crossed, ...toward])].slice(0, Math.max(MAX_CHOICES, crossed.length));
    return { needed: true, label: exportLoad ? 'مرز خروج' : 'مرز ورود', options };
  }

  /** The borders the routes between two points cross, in the order of the routes (the best first). */
  private async crossed(origin: GeoPoint, destination: GeoPoint): Promise<string[]> {
    const plans = await this.routing.routes(origin, destination).catch(() => []);
    return plans.flatMap((plan) => exitBordersOnRoute(decodePolyline(plan.polyline)).map((border) => border.name));
  }

  /**
   * Where the load's origin and destination are. The side abroad of an export or import load is looked up abroad
   * first (RoutingService.pointAbroad): «آنتب» otherwise lands on a namesake in Iran, and the load's route (its map,
   * its border crossings) never leaves Iran.
   */
  async points(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>): Promise<{ origin: GeoPoint | null; destination: GeoPoint | null }> {
    const tripType = await this.tripTypeOf(listing);
    if (tripType === CargoTripType.Domestic) {
      const [origin, destination] = await Promise.all([this.routing.geocode(listing.origin).catch(() => null), this.routing.geocode(listing.destination).catch(() => null)]);
      return { origin, destination };
    }
    // the Latin names find the city itself («آنتب» → Gaziantep, not a shop of that name in Istanbul; «بم» → Bam, not
    // a place near Zanjan)
    const latin = await this.tripTypes.latinNames(listing.origin, listing.destination).catch(() => null);
    const exportLoad = tripType === CargoTripType.Export;
    const [origin, destination] = await Promise.all([
      this.locate(listing.origin, latin?.origin, !exportLoad),
      this.locate(listing.destination, latin?.destination, exportLoad),
    ]);
    return { origin, destination };
  }

  /**
   * One end of an export or import load, by its Latin name: abroad or in Iran as the name's country says, or, for a
   * name without one («Romania»), as the load's type says of that end (abroad: an export's destination, an import's
   * origin). Without a Latin name (a place the model did not know, or it did not answer) only as any place is found:
   * a search abroad with no threshold would land on anything of that name («ازاد» in Afghanistan).
   */
  private async locate(place: string, latinName: string | null | undefined, abroadByType: boolean): Promise<GeoPoint | null> {
    if (latinName) {
      const inIran = latinSide(latinName) ?? !abroadByType;
      const point = inIran ? await this.routing.pointInIran(latinName).catch(() => null) : await this.routing.pointAbroad(place, latinName).catch(() => null);
      if (point) return point;
    }
    return this.routing.geocode(place).catch(() => null);
  }

  /**
   * The load's type; one saved as domestic is asked again (cached per route): a load to «آنتب» or «موراتبی» could be
   * saved domestic when its Turkish city was not known then, and its request must still pick a border.
   */
  async tripTypeOf(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>): Promise<CargoTripType> {
    if (listing.tripType && listing.tripType !== CargoTripType.Domestic) return listing.tripType;
    return (await this.tripTypes.classify(listing.origin, listing.destination).catch(() => null)) ?? CargoTripType.Domestic;
  }

  /** A border as given (spacing, Arabic letters aside), by its name; null when it is not one of the borders. */
  static named(input: unknown): string | null {
    if (typeof input !== 'string' || !input.trim()) return null;
    const wanted = compact(input);
    return EXIT_BORDERS.find((border) => compact(border.name) === wanted)?.name ?? null;
  }
}
