import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { cargoListingSpeech } from '../speech/cargoSpeech';
import { SpeechFormat, TextToSpeechService } from '../speech/textToSpeech.service';

// یک بار برای ده‌ها راننده فرستاده می‌شود؛ صدا یک بار ساخته می‌شود نه برای هر راننده
const CACHE_SIZE = 50;

/** صدای بار اعلام‌شده (Piper)؛ ساخته نشدن صدا جلوی اعلان متنی را نمی‌گیرد (null). */
@Injectable()
export class CargoVoiceService {
  private readonly logger = new Logger(CargoVoiceService.name);
  private readonly cache = new Map<string, Promise<Buffer | null>>();

  constructor(
    private readonly speech: TextToSpeechService,
    private readonly i18n: I18nService,
  ) {}

  get available(): boolean {
    return this.speech.available;
  }

  listingVoice(listing: CargoListing, format: SpeechFormat = 'ogg'): Promise<Buffer | null> {
    if (!this.available) return Promise.resolve(null);
    // ویرایش بار (updatedAt) صدای تازه می‌خواهد
    const key = `${listing.id}:${format}:${listing.updatedAt?.getTime() ?? ''}`;
    let voice = this.cache.get(key);
    if (!voice) {
      voice = this.synthesize(listing, format, key);
      this.cache.set(key, voice);
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }
    return voice;
  }

  private async synthesize(listing: CargoListing, format: SpeechFormat, key: string): Promise<Buffer | null> {
    const t = (name: string, args?: Record<string, string | number>) =>
      this.i18n.translate(`trip.${name}`, { lang: 'fa', args }) as string;
    try {
      return await this.speech.synthesize(cargoListingSpeech(t, listing), format);
    } catch (error) {
      this.logger.warn(`Cargo voice for listing ${listing.id} failed: ${(error as Error).message}`);
      this.cache.delete(key);
      return null;
    }
  }
}
