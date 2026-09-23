import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class SmsService {
  async sendOtp(_phoneNumber: string, _code: string): Promise<void> {
    throw new ServiceUnavailableException('Registration SMS provider has not been configured.');
  }
}
