import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../../domain/entities/auth/jwt-payload.dto';

export const CARGO_NOTIFICATION_SOCKET_EVENT = 'cargo-notification';

export const CARGO_STATUS_SOCKET_EVENT = 'cargo-status';

// بار باز شد (ثبت/انتشار/برگرداندن) یا برداشته شد -- برای همه، تا لیست «بارهای اعلام‌شده»
// راننده‌هایی که اعلانش را نگرفته‌اند (فیلترشان نخورده یا خودشان ناشرند) هم همان لحظه بروز شود.
export const CARGO_LISTING_CHANGED_SOCKET_EVENT = 'cargo-listing-changed';

// تغییر وضعیت عضویت گروه/کانال ثبت‌شده (عضو شد، منتظر تأیید، ناموفق، حذف شد).
export const CHANNEL_STATUS_SOCKET_EVENT = 'channel-status';

// شرکت نام یا شماره‌ی پروفایلش را عوض کرد: { items: [{ id, companyName, contactPhones }] } بارهایی که عوض شدند،
// تا صفحه‌های باز همان کارت‌ها را بی‌درخواست دوباره اصلاح کنند (CargoContactSync).
export const CARGO_LISTING_CONTACT_SOCKET_EVENT = 'cargo-listing-contact';

// پروفایل یک راننده (نام، ناوگان، عکس، نوع حمل) عوض شد -- برای شرکت‌ها، تا صفحه‌ی «رانندگان» بی‌رفرش بروز شود.
export const DRIVERS_CHANGED_SOCKET_EVENT = 'drivers-changed';

/**
 * اعلان لحظه‌ای برای کاربرهای آنلاین پنل وب. کلاینت باید token را بفرستد:
 *   io(`${API_URL}/notifications`, { path: '/socket.io', auth: { token } })
 * کاربر از روی JWT شناخته می‌شود، نه از query، تا کسی نتواند اعلان‌های
 * کاربر دیگری را بگیرد. چون احراز هویت با token است نه cookie، origin باز است.
 */
@WebSocketGateway({
  namespace: '/notifications',
  path: '/socket.io',
  cors: { origin: true, credentials: false },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const payload = await this.authenticate(client);
    if (!payload) {
      client.disconnect(true);
      return;
    }

    client.data.userId = payload.userId;
    await client.join(this.room(payload.userId));
    for (const role of payload.roles ?? []) await client.join(this.roleRoom(role));
  }

  sendToUser(userId: string, event: string, data: unknown): void {
    this.server?.to(this.room(userId)).emit(event, data);
  }

  /** به همه‌ی کاربرهای آنلاین این نقش‌ها (هر اتصال یک بار)؛ نقش‌ها از JWT همان لحظه‌ی اتصال. */
  sendToRoles(roles: string[], event: string, data: unknown): void {
    this.server?.to(roles.map((role) => this.roleRoom(role))).emit(event, data);
  }

  /** به همه‌ی اتصال‌های باز؛ فقط برای داده‌ای که همه‌ی کاربرها اجازه‌ی دیدنش را دارند. */
  broadcast(event: string, data: unknown): void {
    this.server?.emit(event, data);
  }

  /** آیا کاربر الان حداقل یک اتصال باز به پنل وب دارد؟ */
  async isOnline(userId: string): Promise<boolean> {
    if (!this.server) return false;
    return (await this.server.in(this.room(userId)).fetchSockets()).length > 0;
  }

  private async authenticate(client: Socket): Promise<JwtPayload | null> {
    const header = client.handshake.headers.authorization;
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return payload.isActive === false || !payload.userId ? null : payload;
    } catch (error) {
      this.logger.debug(`Rejected notification socket: ${(error as Error).message}`);
      return null;
    }
  }

  private room(userId: string): string {
    return `user:${userId}`;
  }

  private roleRoom(role: string): string {
    return `role:${role}`;
  }
}
