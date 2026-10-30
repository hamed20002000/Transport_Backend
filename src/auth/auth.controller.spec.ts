import { RegistrationService } from 'src/services/auth/registration.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { ImageService } from 'src/application/services/helper/image.service';
import { ResponseInterceptor } from 'src/interceptors/response.interceptor';

describe('AuthController (mobile + SMS code only)', () => {
  let app: INestApplication;
  const create = jest.fn();
  const verifyOtp = jest.fn();
  const complete = jest.fn();
  const refresh = jest.fn();
  const revoke = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegistrationService, useValue: { requestOtp: create, verifyOtp, completeRegistration: complete, refresh, revoke } },
        { provide: ImageService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });
  beforeEach(() => {
    create.mockReset();
    complete.mockReset();
  });
  afterAll(async () => {
    await app.close();
  });

  it('requests an OTP with only a normalized phone number', async () => {
    create.mockResolvedValue({ phoneNumber: '09123456789', expiresIn: 300 });
    await request(app.getHttpServer()).post('/api/auth/otp/request').send({ phoneNumber: '+98 912 345 6789' }).expect(200);
    expect(create).toHaveBeenCalledWith('09123456789');
  });

  it.each([
    {},
    { phoneNumber: '123' },
    { phoneNumber: '09123456789', username: 'user', password: 'password123' },
    { phoneNumber: '09123456789', accountType: 'DRIVER' },
  ])('rejects anything but a phone number when requesting an OTP: %j', async (body) => {
    await request(app.getHttpServer()).post('/api/auth/otp/request').send(body).expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes phone numbers on verification and returns the tokens', async () => {
    verifyOtp.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    const response = await request(app.getHttpServer())
      .post('/api/auth/otp/verify')
      .send({ phoneNumber: '۰۹۱۲۳۴۵۶۷۸۹', code: '123456' })
      .expect(200);
    expect(verifyOtp).toHaveBeenCalledWith('09123456789', '123456');
    expect(response.body.data.accessToken).toBe('access');
  });

  it.each([
    { phoneNumber: '09123456789', code: 123456 },
    { phoneNumber: '123', code: '123456' },
  ])('rejects malformed verification: %j', async (body) => {
    await request(app.getHttpServer()).post('/api/auth/otp/verify').send(body).expect(400);
  });

  it.each(['DRIVER', 'COMPANY'])('completes registration as %s', async (accountType) => {
    complete.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });
    const registrationToken = 'a'.repeat(64);
    await request(app.getHttpServer()).post('/api/auth/otp/complete').send({ registrationToken, accountType }).expect(200);
    expect(complete).toHaveBeenCalledWith(registrationToken, accountType);
  });

  it.each([
    { registrationToken: 'a'.repeat(64) },
    { registrationToken: 'short', accountType: 'DRIVER' },
    { registrationToken: 'a'.repeat(64), accountType: 'SUPER_ADMIN' },
    { registrationToken: 'a'.repeat(64), accountType: 'DRIVER', roles: ['Admin'] },
  ])('rejects invalid completion input: %j', async (body) => {
    await request(app.getHttpServer()).post('/api/auth/otp/complete').send(body).expect(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it('revokes the refresh token on logout', async () => {
    const refreshToken = 'b'.repeat(96);
    await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken }).expect(204);
    expect(revoke).toHaveBeenCalledWith(refreshToken);
  });

  it.each(['/api/auth/login', '/api/auth/register', '/api/auth/register/request-otp', '/api/auth/register/verify-otp'])(
    'has no username/password route %s',
    async (path) => {
      await request(app.getHttpServer()).post(path).send({}).expect(404);
    },
  );
});
