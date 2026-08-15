import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

import { IdentityKafkaTopic } from '@/identity/common/enums';
import { TenantCreatedEvent } from './tenant-created.event';

/**
 * Publishes tenant events for other contexts to act on.
 *
 * **This is a dual write, and it is the only one in the system.** Everywhere else
 * a fact reaches Kafka by way of Debezium reading the oplog, precisely so that a
 * crash between storing and publishing cannot lose the event (ADR-002). Here the
 * tenant is written to MongoDB and then published in a second, separate step.
 *
 * That is acceptable *here* and would not be elsewhere, because losing this event
 * costs nothing durable: the alias it asks messaging to create is also created
 * lazily on the tenant's first message. The event makes that happen sooner; it is
 * not what makes it happen. A lost publish degrades to the behaviour the system
 * had before this class existed.
 *
 * `acks: all` and an idempotent producer, so a retry cannot duplicate or reorder
 * — cheap insurance on a stream this quiet.
 */
@Injectable()
export class TenantEventsPublisher
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TenantEventsPublisher.name);
  private producer?: Producer;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const kafka = new Kafka({
      clientId: 'identity-tenant-events',
      brokers: this.configService
        .getOrThrow<string>('KAFKA_BROKERS')
        .split(',')
        .map((broker) => broker.trim()),
    });

    this.producer = kafka.producer({ idempotent: true });
    await this.producer.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.producer?.disconnect();
  }

  /**
   * Failure is logged, not thrown.
   *
   * The tenant is already stored by the time this runs, and a broker that is down
   * is no reason to tell the caller their tenant was not created — it was. The
   * lazy path covers what this one missed.
   */
  async tenantCreated(event: TenantCreatedEvent): Promise<void> {
    try {
      await this.producer?.send({
        topic: IdentityKafkaTopic.IdentityTenantCreated,
        messages: [
          {
            // Keyed by tenant so a tenant's events stay ordered, the same reason
            // messages are keyed by conversation (D12).
            key: event.tenantId,
            value: JSON.stringify(event),
          },
        ],
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${IdentityKafkaTopic.IdentityTenantCreated} for ${event.tenantId}; ` +
          'the alias will be created lazily on the first message instead',
        error,
      );
    }
  }
}
