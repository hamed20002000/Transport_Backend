import { Injectable } from '@nestjs/common';

import { CargoListing } from 'src/domain/entities/notification/CargoListing';
import { CargoTripType } from 'src/domain/enums/notification';
import { bordersOf, bordersToward, EXIT_BORDERS, exitBordersOnRoute, neighbourOf } from '../border/exitBorders';
import { decodePolyline, GeoPoint, haversineKm } from '../routing/geo';
import { RoutingService } from '../routing/routing.service';
import { CargoTripTypeService, latinSide } from './cargoTripType';
import { LlmUnavailableError } from '../common/llmClient';

// any other failure leaves a guess (no Latin name, a domestic load); OpenAI not answering is told to the one waiting
const unlessUnavailable = (error: unknown) => {
  if (error instanceof LlmUnavailableError) throw error;
  return null;
};

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
    const { origin, destination, latin } = await this.resolve(listing, tripType);
    const crossed = origin && destination ? await this.crossed(origin, destination) : [];
    // a country across Iran's land border (Turkey, Iraq, Armenia…): its own borders only, the ones its routes cross
    // first; a route through a third country (Tehran → Ankara by Iraq) does not make Bashmaq a way to Turkey
    const neighbour = neighbourOf(exportLoad ? latin?.destination : latin?.origin);
    if (neighbour) {
      // the rest nearest the place abroad first (Baghdad: Khosravi and Mehran before Shalamcheh)
      const abroad = exportLoad ? destination : origin;
      const own = bordersOf(neighbour)
        .sort((a, b) => (abroad ? haversineKm(abroad, a.point) - haversineKm(abroad, b.point) : 0))
        .map((border) => border.name);
      return { needed: true, label: exportLoad ? 'مرز خروج' : 'مرز ورود', options: [...new Set([...crossed.filter((name) => own.includes(name)), ...own])] };
    }
    // beyond the neighbours (Georgia, Russia, Bulgaria…): the borders the load's own routes cross (Tbilisi by Astara
    // or Bazargan), then those toward the place abroad for a route that crosses none known
    const toward = bordersToward(exportLoad ? destination : origin).map((border) => border.name);
    const options = [...new Set([...crossed, ...toward])].slice(0, Math.max(MAX_CHOICES, crossed.length));
    return { needed: true, label: exportLoad ? 'مرز خروج' : 'مرز ورود', options };
  }

  /**
   * Works out a newly published load's borders in the background (its type, places, roads: all cached), so a driver
   * requesting it gets the list at once instead of waiting for the model and the maps. Never fails.
   */
  warm(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>): void {
    if (listing.tripType === CargoTripType.Domestic) return;
    void this.choices(listing).catch(() => undefined);
  }

  /** The borders the routes between two points cross, in the order of the routes (the best first). */
  private async crossed(origin: GeoPoint, destination: GeoPoint): Promise<string[]> {
    // the roads alone: the routes' «از طریق …» names are Nominatim lookups a second apart the borders do not need
    const plans = await this.routing.routeShapes(origin, destination).catch(() => []);
    return plans.flatMap((plan) => exitBordersOnRoute(decodePolyline(plan.polyline)).map((border) => border.name));
  }

  /**
   * Where the load's origin and destination are. The side abroad of an export or import load is looked up abroad
   * first (RoutingService.pointAbroad): «آنتب» otherwise lands on a namesake in Iran, and the load's route (its map,
   * its border crossings) never leaves Iran.
   */
  async points(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>): Promise<{ origin: GeoPoint | null; destination: GeoPoint | null }> {
    const { origin, destination } = await this.resolve(listing);
    return { origin, destination };
  }

  /** The load's ends on the map, and their Latin names for one going abroad (null for a domestic load). */
  private async resolve(listing: Pick<CargoListing, 'tripType' | 'origin' | 'destination'>, known?: CargoTripType) {
    const tripType = known ?? (await this.tripTypeOf(listing));
    if (tripType === CargoTripType.Domestic) {
      const [origin, destination] = await Promise.all([this.routing.geocode(listing.origin).catch(() => null), this.routing.geocode(listing.destination).catch(() => null)]);
      return { origin, destination, latin: null };
    }
    // the Latin names find the city itself («آنتب» → Gaziantep, not a shop of that name in Istanbul; «بم» → Bam, not
    // a place near Zanjan)
    const latin = await this.tripTypes.latinNames(listing.origin, listing.destination).catch(unlessUnavailable);
    const exportLoad = tripType === CargoTripType.Export;
    const [origin, destination] = await Promise.all([
      this.locate(listing.origin, latin?.origin, !exportLoad),
      this.locate(listing.destination, latin?.destination, exportLoad),
    ]);
    return { origin, destination, latin };
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
    return (await this.tripTypes.classify(listing.origin, listing.destination).catch(unlessUnavailable)) ?? CargoTripType.Domestic;
  }

  /** A border as given (spacing, Arabic letters aside), by its name; null when it is not one of the borders. */
  static named(input: unknown): string | null {
    if (typeof input !== 'string' || !input.trim()) return null;
    const wanted = compact(input);
    return EXIT_BORDERS.find((border) => compact(border.name) === wanted)?.name ?? null;
  }
}
