import {
  Injectable,
} from '@nestjs/common';

import {
  I18nService,
} from 'nestjs-i18n';

@Injectable()
export class TelegramMessagesService {
  constructor(
    private readonly i18n:
      I18nService,
  ) {}

  get(
    key: string,
    lang = 'fa',
    args?: Record<
      string,
      string | number
    >,
  ): string {
    return this.i18n.translate(
      `telegram.${key}`,
      {
        lang,
        args,
      },
    ) as string;
  }
}