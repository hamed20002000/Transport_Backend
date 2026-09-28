import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

/**
 * JWT با RS256: توکن فقط با کلید خصوصی (فقط همین سرویس) امضا می‌شه و با
 * کلید عمومی بررسی می‌شه. trabari فقط کلید عمومی رو داره، پس نمی‌تونه توکن بسازه.
 */
export const JWT_ALGORITHM = 'RS256' as const;

function readKey(configService: ConfigService, name: string): string {
  const path = resolve(process.cwd(), configService.getOrThrow<string>(name));
  return readFileSync(path, 'utf8');
}

export const readJwtPublicKey = (configService: ConfigService): string =>
  readKey(configService, 'JWT_PUBLIC_KEY_PATH');

/** برای ماژولی که توکن صادر می‌کنه (لاگین/ثبت‌نام). */
export function jwtSigningOptions(configService: ConfigService): JwtModuleOptions {
  return {
    privateKey: readKey(configService, 'JWT_PRIVATE_KEY_PATH'),
    publicKey: readJwtPublicKey(configService),
    signOptions: {
      algorithm: JWT_ALGORITHM,
      expiresIn: configService.get<string>('JWT_EXPIRATION_TIME', '64800s'),
    },
    verifyOptions: { algorithms: [JWT_ALGORITHM] },
  };
}

/** برای ماژول‌هایی که فقط توکن رو بررسی می‌کنن. */
export function jwtVerifyOnlyOptions(configService: ConfigService): JwtModuleOptions {
  return {
    publicKey: readJwtPublicKey(configService),
    verifyOptions: { algorithms: [JWT_ALGORITHM] },
  };
}
