import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import axios from 'axios';

@Injectable()
export class AppleAuthService {
  constructor(private readonly httpService: HttpService) { }

  private generateClientSecret(): string {
    const teamId = '9Z4732CNCV'; // Your Apple Team ID
    const clientId = 'com.matesbridge.matesbridgeService'; // Your Service ID (e.g., com.example.app)
    const keyId = '7QLYM6T942'; // The Key ID from the .p8 file
    // Path to your private key file
    var privateKeyPath = './src/auth/apple-key/AuthKey_7QLYM6T942.p8';

    /* const privateKeyPath = path.join(__dirname, '..', 'src', 'apple-key', 'AuthKey_ABC123.p8'); */

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

  async getAppleToken(code: string): Promise<any> {
    const clientId = 'YOUR_CLIENT_ID'; // Your Service ID
    const clientSecret = this.generateClientSecret(); // Generate the clientSecret
    const redirectUri = 'YOUR_REDIRECT_URI'; // Your redirect URI

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri);

    const url = 'https://appleid.apple.com/auth/token';

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      return response.data;
    } catch (error) {
      throw new Error('Failed to get token from Apple');
    }
  }
}

const validateAppleIdToken = async (idToken: string) => {
  try {
    // Step 1: Fetch Apple's public keys
    const response = await axios.get('https://appleid.apple.com/auth/keys');
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

    // Step 4: Verify the token using the public key
    const publicKey = getPublicKeyFromJWK(matchingKey);
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: 'com.example.app', // Your client ID
      issuer: 'https://appleid.apple.com',
    });

    return payload;
  } catch (error) {

     const message =
    error instanceof Error
      ? error.message
      : String(error);


    throw new Error(`Failed to validate id_token: ${message}`);
  }
};

// Helper function to convert JWK to PEM format
const getPublicKeyFromJWK = (jwk: any) => {
  const { n: modulus, e: exponent } = jwk;
  const buffer = Buffer.from(modulus, 'base64');
  const exponentBuffer = Buffer.from(exponent, 'base64');

  const publicKey = {
    kty: 'RSA',
    n: buffer.toString('base64'),
    e: exponentBuffer.toString('base64'),
  };

  return `-----BEGIN PUBLIC KEY-----\n${publicKey.n}\n-----END PUBLIC KEY-----`;
};


