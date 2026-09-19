import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import {
  Profile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy,
  'google',
) {
  constructor(
    private readonly configService: ConfigService,
  ) {
    super({
      clientID:
        configService.getOrThrow<string>(
          'GOOGLE_CLIENT_ID',
        ),

      clientSecret:
        configService.getOrThrow<string>(
          'GOOGLE_CLIENT_SECRET',
        ),

      callbackURL:
        configService.getOrThrow<string>(
          'GOOGLE_REDIRECT_URI',
        ),

      scope: [
        'email',
        'profile',
      ],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email =
      profile.emails?.[0]?.value;

    const photo =
      profile.photos?.[0]?.value;

    const user = {
      googleId: profile.id,
      email,
      firstName:
        profile.name?.givenName ?? '',
      lastName:
        profile.name?.familyName ?? '',
      picture: photo,
      accessToken,
    };

    done(null, user);
  }
}