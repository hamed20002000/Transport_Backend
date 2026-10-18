import { BadRequestException } from '@nestjs/common';

export class NoCargoRecipientsException extends BadRequestException {
  constructor() {
    super({
      code: 'noCargoRecipients',
      message: 'بار اعلام نشد؛ راننده‌ای که عضو شرکت شما باشد و نوع حمل، اشتراک و تنظیمات متناسب داشته باشد پیدا نشد.',
    });
  }
}
