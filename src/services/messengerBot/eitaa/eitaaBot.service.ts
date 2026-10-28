import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { MultiBot } from '../core/multiBot';
import { EitaaClient, GoOmniEvent } from './eitaaClient';

// a processed event is remembered this long: GoOmni delivers at least once and retries
const EVENT_TTL_SECONDS = 2 * 24 * 3600;
// someone who wrote once may get their notifications for this long after their last message
const PEER_TTL_SECONDS = 365 * 24 * 3600;

/**
 * The Eitaa bot: an ordinary Eitaa account logged in to GoOmni (see EitaaClient). GoOmni posts the account's
 * messages to /eitaa/webhook signed with EITAA_WEBHOOK_SECRET; sends go to its REST API.
 *
 *   EITAA_GOOMNI_URL        GoOmni's address, e.g. http://127.0.0.1:3000
 *   EITAA_GOOMNI_AUTH       its APP_BASIC_AUTH (user:password)
 *   EITAA_DEVICE_ID         the connection's alias in GoOmni (X-Device-Id)
 *   EITAA_DEVICE_INSTANCE   the connection's instance_id (X-Device-Instance)
 *   EITAA_WEBHOOK_SECRET    the webhook signing secret
 *   EITAA_WEBHOOK_URL       optional: this backend's /eitaa/webhook as GoOmni reaches it; set on GoOmni at start
 *   EITAA_ACCOUNT           how users find the account (its @username or number), shown in the web panel
 *   EITAA_ALLOWED_PEERS     optional, for testing on a personal account: comma-separated Eitaa user ids the bot answers;
 *                           anyone else's messages are left alone (no reply, not marked read)
 */
@Injectable()
export class EitaaBotService implements OnModuleInit {
  private readonly logger = new Logger(EitaaBotService.name);
  private client?: EitaaClient;
  private secret = '';
  private deviceId = '';
  private instanceId = '';
  private allowedPeers: Set<string> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly multiBot: MultiBot,
    private readonly redis: RedisService,
  ) {}

  get account(): string | null {
    return this.client ? this.config.get<string>('EITAA_ACCOUNT')?.trim() || null : null;
  }

  onModuleInit(): void {
    const url = this.config.get<string>('EITAA_GOOMNI_URL');
    const auth = this.config.get<string>('EITAA_GOOMNI_AUTH');
    this.deviceId = this.config.get<string>('EITAA_DEVICE_ID') ?? '';
    this.instanceId = this.config.get<string>('EITAA_DEVICE_INSTANCE') ?? '';
    this.secret = this.config.get<string>('EITAA_WEBHOOK_SECRET') ?? '';
    if (!url || !auth || !this.deviceId || !this.instanceId) {
      this.logger.warn('EITAA_GOOMNI_URL, EITAA_GOOMNI_AUTH, EITAA_DEVICE_ID or EITAA_DEVICE_INSTANCE is not configured. Eitaa bot is disabled.');
      return;
    }
    if (this.secret.length < 16) {
      this.logger.error('EITAA_WEBHOOK_SECRET (at least 16 characters) is required. Eitaa bot is disabled.');
      return;
    }

    const allowed = (this.config.get<string>('EITAA_ALLOWED_PEERS') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (allowed.length) {
      this.allowedPeers = new Set(allowed);
      this.logger.warn(`Eitaa bot answers only EITAA_ALLOWED_PEERS (${allowed.length} account(s)).`);
    }

    this.client = new EitaaClient(url, auth, this.deviceId, this.instanceId, {
      canWrite: (peerId) => this.redis.exists(this.peerKey(peerId)),
    });
    this.multiBot.register('eitaa', this.client);
    void this.configureWebhook(url, auth);
  }

  /** Points the GoOmni connection's webhook at this backend: private incoming messages only. */
  private async configureWebhook(url: string, auth: string): Promise<void> {
    const webhookUrl = this.config.get<string>('EITAA_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.log('Eitaa bot started; its GoOmni webhook is configured by hand (EITAA_WEBHOOK_URL is not set).');
      return;
    }
    try {
      await axios.patch(
        `${url.replace(/\/+$/, '')}/devices/${encodeURIComponent(this.deviceId)}/webhook`,
        {
          webhook_url: webhookUrl,
          webhook_secret: this.secret,
          webhook_events: ['message'],
          webhook_filter: { peer_types: ['user'], directions: ['incoming'] },
        },
        { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}`, 'X-Device-Instance': this.instanceId }, timeout: 15_000 },
      );
      this.logger.log('Eitaa bot started; GoOmni webhook set.');
    } catch (error) {
      this.logger.error(`Could not set the Eitaa GoOmni webhook: ${(error as Error).message}`);
    }
  }

  /**
   * A GoOmni delivery: the signature over the exact body first, then the connection it claims, then once per event.
   * The sender is remembered as someone the account may write to.
   */
  async receiveWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<void> {
    if (!this.client || !rawBody) throw new UnauthorizedException();
    const expected = Buffer.from(`sha256=${createHmac('sha256', this.secret).update(rawBody).digest('hex')}`);
    const received = Buffer.from(signature ?? '');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException();

    const event = JSON.parse(rawBody.toString('utf8')) as GoOmniEvent;
    if (!event?.event_id || event.event_id !== eventIdHeader) throw new UnauthorizedException();
    // another connection's event (a second account on the same GoOmni): not this bot's
    if (event.instance_id !== this.instanceId || event.session_id !== this.deviceId || (event.provider && event.provider !== 'eitaa')) return;
    if (this.allowedPeers && !this.allowedPeers.has(String(event.peer?.id))) {
      this.logger.log(`Eitaa: left alone a message from ${event.peer?.id} (not in EITAA_ALLOWED_PEERS).`);
      return;
    }
    if (!(await this.redis.setIfAbsent(RedisService.key('eitaaEvent', this.instanceId, event.event_id), '1', EVENT_TTL_SECONDS))) return;

    if (event.event === 'message' && event.direction === 'incoming' && event.peer?.type === 'user' && event.sender_id === event.peer.id) {
      await this.redis.set(this.peerKey(event.peer.id), '1', PEER_TTL_SECONDS);
    }
    this.client.handleEvent(event);
  }

  private peerKey(peerId: string): string {
    return RedisService.key('eitaaPeer', this.instanceId, peerId);
  }
}
