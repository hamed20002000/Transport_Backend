import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { importJWK, jwtVerify } from 'jose'; // For JWK to PEM conversion and JWT verification

export interface AppleUser {
  id: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class AppleAuthService {
  constructor(private readonly httpService: HttpService) {}

  // Generate the client secret for Apple Sign-In
  private generateClientSecret(): string {
    const teamId = '9Z4732CNCV'; // Your Apple Team ID
    const clientId = 'com.matesbridge.matesbridgeService'; // Your Service ID
    const keyId = '7QLYM6T942'; // The Key ID from the .p8 file
    const privateKeyPath = './auth/apple-key/AuthKey_7QLYM6T942.p8'; // Path to your private key file

    // Read the private key from the file
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const expirationTime = now + 3600; // 1 hour from now

    const payload = {
      iss: teamId, // Issuer (your Team ID)
      iat: now, // Issued at (current time)
      exp: expirationTime, // Expiration time
      aud: 'https://appleid.apple.com', // Audience (Apple's OAuth2 server)
      sub: clientId, // Subject (your Client ID)
    };

    const options: jwt.SignOptions = {
      algorithm: 'ES256', // Algorithm used by Apple
      keyid: keyId, // Key ID
    };

    return jwt.sign(payload, privateKey, options);
  }

  // Validate the Apple id_token and map it to a user object
  private async validateAppleIdToken(idToken: string): Promise<AppleUser> {
    try {
      // Step 1: Fetch Apple's public keys
      const response = await firstValueFrom(
        this.httpService.get('https://appleid.apple.com/auth/keys'),
      );
      const keys = response.data.keys;

      // Step 2: Decode the JWT header to get the `kid`
      const decodedHeader = jwt.decode(idToken, { complete: true })?.header;
      if (!decodedHeader || !decodedHeader.kid) {
        throw new Error('Invalid id_token: Missing kid in header');
      }

      // Step 3: Find the matching public key
      const matchingKey = keys.find((key: any) => key.kid === decodedHeader.kid);
      if (!matchingKey) {
        throw new Error('Invalid id_token: No matching public key found');
      }

      // Step 4: Convert JWK to a cryptographic key
      const publicKey = await importJWK(matchingKey, 'RS256');

      // Step 5: Verify the token using the public key
      const { payload } = await jwtVerify(idToken, publicKey, {
        audience: 'com.matesbridge.matesbridgeService', // Your client ID
        issuer: 'https://appleid.apple.com',
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.email_verified !== 'boolean'||
        typeof payload.iss !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid payload: Missing or invalid fields');
      }
      // Step 6: Map the payload to a user object
      const appleUser: AppleUser = {
        id: payload.sub, // Unique user identifier
        email: payload.email, // User's email
        emailVerified: payload.email_verified === true, // Convert to boolean
        issuer: payload.iss, // Token issuer
        issuedAt: payload.iat, // Token issued at (timestamp)
        expiresAt: payload.exp, // Token expires at (timestamp)
      };

      return appleUser;
    } catch (error:unknown) {
      const message =
    error instanceof Error
      ? error.message
      : String(error);
      throw new Error(`Failed to validate id_token: ${message}`);
    }
  }

  // Exchange the authorization code for an access token and id_token
  async getAppleToken(code: string): Promise<{ access_token: string; user: AppleUser }> {
    const clientId = 'com.matesbridge.matesbridgeService'; // Your Service ID
    const clientSecret = this.generateClientSecret(); // Generate the clientSecret
    const redirectUri = 'https://matesbridge.com/api/auth/apple/callback'; // Your redirect URI

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri);

    const url = 'https://appleid.apple.com/auth/token';

    try {
      // Step 1: Exchange the code for an access token and id_token
      const response = await firstValueFrom(
        this.httpService.post(url, params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      const idToken = response.data.id_token;

      // Step 2: Validate the id_token and map it to a user object
      const user = await this.validateAppleIdToken(idToken);

      return {
        access_token: response.data.access_token,
        user, // Mapped user object
      };
    } catch (error) {

      const message =
    error instanceof Error
      ? error.message
      : String(error);

      throw new Error(`Failed to get token from Apple: ${message}`);
    }
  }
}