import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';

import { CargoNotificationService, QueuedOutcome } from './cargoNotification.service';
import { MESSENGER_ORDER, Messenger } from './messengerOrder';
import { RateLimiter } from './rateLimiter';

/**
 * A notice of a load to send (or its message to edit) through one messenger; or (digest) a driver's loads held for one
 * summary message, id being the driver's user id.
 */
export interface DeliveryJob {
  id: string;
  messenger: Messenger;
  kind: 'send' | 'edit' | 'digest';
  /** unexpected failures so far (the database down, …) */
  tries?: number;
}

const queueOf = (messenger: Messenger) => `transport.cargo-delivery.${messenger}`;
// a job waiting to be tried again: it expires back into its messenger's queue
const retryQueueOf = (messenger: Messenger) => `${queueOf(messenger)}.retry`;
const DEAD_LETTER_QUEUE = 'transport.cargo-delivery.dlq';
const MAX_TRIES = 5;
const ERROR_RETRY_MS = 30_000;

type QueueChannel = { assertQueue(queue: string, options: Record<string, unknown>): Promise<unknown> };

/**
 * Jobs a second each messenger is sent, at most (CARGO_RATE_<MESSENGER> in .env). A job is up to three messages (the
 * load's picture, its text, its voice): Telegram takes about 30 messages a second from one bot. WhatsApp is slow on
 * purpose: our number is no official bot, and a burst of messages gets it banned.
 */
const DEFAULT_RATES: Record<Messenger, number> = { bale: 10, eitaa: 5, rubika: 5, telegram: 10, whatsapp: 0.5 };

/**
 * The queue that sends a load's notices to its drivers (and edits them when the load is taken or changed), on
 * RabbitMQ: one queue per messenger, each sent at that messenger's pace, so a slow or blocked messenger holds up only
 * its own. A job tried again later waits in a retry queue (its message expires back); one a messenger cannot take goes
 * on to the user's next messenger. The jobs are kept on RabbitMQ's disk: a restart loses none, and only one consumer
 * takes each, so none is sent twice. The notice's state stays in CargoNotification.
 */
@Injectable()
export class CargoDeliveryQueue implements OnApplicationBootstrap {
  private readonly logger = new Logger(CargoDeliveryQueue.name);
  private readonly limiters = new Map<Messenger, RateLimiter>();
  private enabled = false;

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly delivery: CargoNotificationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_DELIVERY_QUEUE', 'true') === 'false') return;
    this.enabled = true;
    for (const messenger of MESSENGER_ORDER) {
      const rate = Number(this.config.get(`CARGO_RATE_${messenger.toUpperCase()}`, DEFAULT_RATES[messenger]));
      this.limiters.set(messenger, new RateLimiter(rate > 0 ? rate : DEFAULT_RATES[messenger]));
    }
    // not awaited: the API comes up even while RabbitMQ is down (as CargoEventConsumer)
    void this.subscribe().catch((error: Error) => this.logger.error(`Setting up the cargo delivery queues failed`, error.stack));
  }

  private async subscribe(): Promise<void> {
    await this.amqp.managedChannel.addSetup(async (channel: QueueChannel) => {
      await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
      for (const messenger of MESSENGER_ORDER) {
        await channel.assertQueue(retryQueueOf(messenger), { durable: true, deadLetterExchange: '', deadLetterRoutingKey: queueOf(messenger) });
      }
    });
    for (const messenger of MESSENGER_ORDER) {
      await this.amqp.createSubscriber(
        (job?: DeliveryJob) => this.handle(job),
        {
          queue: queueOf(messenger),
          queueOptions: { durable: true, deadLetterExchange: '', deadLetterRoutingKey: DEAD_LETTER_QUEUE },
          // only when ack/nack itself fails (the channel closed): the job is delivered again after reconnecting
          errorHandler: (channel, message, error) => {
            try {
              channel.nack(message, false, true);
            } catch {
              this.logger.warn(`Cargo delivery job not acknowledged; it will come again (${(error as Error)?.message})`);
            }
          },
        },
        // the channel hands out RABBITMQ_PREFETCH jobs at once (RabbitMqModule); the rate limiter paces the sends
        `${CargoDeliveryQueue.name}.${messenger}`,
      );
      this.logger.log(`Consuming ${queueOf(messenger)}`);
    }
  }

  /** Whether jobs can be queued now; when not, the caller sends another way (the retry worker). */
  get available(): boolean {
    return this.enabled && this.amqp.connected;
  }

  /** Queues the jobs; the ones RabbitMQ did not take are returned, for the caller to send another way. */
  async enqueue(jobs: DeliveryJob[]): Promise<DeliveryJob[]> {
    if (!this.available) return jobs;
    const failed: DeliveryJob[] = [];
    for (let start = 0; start < jobs.length; start += 500) {
      await Promise.all(
        jobs.slice(start, start + 500).map((job) =>
          this.publish(queueOf(job.messenger), job).catch(() => {
            failed.push(job);
          }),
        ),
      );
    }
    if (failed.length) this.logger.warn(`${failed.length} cargo delivery job(s) could not be queued`);
    return failed;
  }

  async handle(job?: DeliveryJob): Promise<void | Nack> {
    if (!job?.id || !MESSENGER_ORDER.includes(job.messenger)) {
      this.logger.error(`Invalid cargo delivery job moved to DLQ: ${JSON.stringify(job)?.slice(0, 300)}`);
      return new Nack(false);
    }
    await this.limiters.get(job.messenger)!.take();
    let outcome: QueuedOutcome;
    try {
      outcome =
        job.kind === 'edit' ? await this.delivery.editQueued(job.id, job.messenger)
        : job.kind === 'digest' ? await this.delivery.deliverDigest(job.id, job.messenger)
        : await this.delivery.deliverQueued(job.id, job.messenger);
    } catch (error) {
      const tries = (job.tries ?? 0) + 1;
      this.logger.error(`Cargo delivery job ${job.kind} ${job.id} via ${job.messenger} failed (${tries}/${MAX_TRIES}): ${(error as Error).message}`);
      if (tries >= MAX_TRIES) return new Nack(false);
      outcome = { kind: 'retry', at: new Date(Date.now() + ERROR_RETRY_MS) };
      job = { ...job, tries };
    }
    try {
      await this.follow(job, outcome);
    } catch (error) {
      // the next step could not be queued: this job comes again
      this.logger.warn(`Cargo delivery job ${job.id}: next step not queued (${(error as Error).message})`);
      return new Nack(true);
    }
  }

  private async follow(job: DeliveryJob, outcome: QueuedOutcome): Promise<void> {
    if (outcome.kind === 'retry') {
      if (outcome.pauseMs) this.limiters.get(job.messenger)!.pause(outcome.pauseMs);
      const delay = Math.max(1000, outcome.at.getTime() - Date.now());
      await this.publish(retryQueueOf(job.messenger), job, String(delay));
    } else if (outcome.kind === 'next') {
      await this.publish(queueOf(outcome.messenger), { ...job, messenger: outcome.messenger, tries: 0 });
    } else if (outcome.kind === 'digest') {
      // the driver's summary waits in the retry queue until its time (the job's id: the driver)
      if (outcome.pauseMs) this.limiters.get(job.messenger)!.pause(outcome.pauseMs);
      const delay = Math.max(1000, outcome.at.getTime() - Date.now());
      await this.publish(retryQueueOf(job.messenger), { id: outcome.userId, messenger: job.messenger, kind: 'digest' }, String(delay));
    } else if (outcome.kind === 'jobs') {
      for (const next of outcome.jobs) await this.publish(queueOf(next.messenger), next);
    }
  }

  private async publish(queue: string, job: DeliveryJob, expiration?: string): Promise<void> {
    const ok = await this.amqp.publish('', queue, job, { persistent: true, ...(expiration && { expiration }) });
    if (!ok) throw new Error(`RabbitMQ did not take the job for ${queue}`);
  }
}
