import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachBatchPayload, Kafka } from 'kafkajs';

import {
  ExternalKafkaConsumerGroup,
  ExternalKafkaTopic,
} from '@/messaging/common/enums';
import { TenantCreatedHandler } from './handler';
import { TenantCreatedEvent } from './tenant-created.event';

/**
 * Subscribes to Identity's tenant stream, in its own consumer group.
 *
 * A separate group from the indexer's rather than a second subscription on the
 * same one: the two streams have nothing to do with each other, and sharing a
 * group would mean a poison record on one stalling the other. Separate groups
 * mean separate offsets and separate failure.
 */
@Injectable()
export class TenantCreatedConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TenantCreatedConsumer.name);
  private consumer?: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantCreatedHandler: TenantCreatedHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    const kafka = new Kafka({
      clientId: ExternalKafkaConsumerGroup.TenantProvisioner,
      brokers: this.configService
        .getOrThrow<string>('KAFKA_BROKERS')
        .split(',')
        .map((broker) => broker.trim()),
    });

    this.consumer = kafka.consumer({
      groupId: ExternalKafkaConsumerGroup.TenantProvisioner,
    });

    await this.consumer.connect();
    // From the beginning, so a consumer started after a tenant was created still
    // provisions it. Replaying costs nothing — `ensureAlias` is idempotent.
    await this.consumer.subscribe({
      topic: ExternalKafkaTopic.IdentityTenantCreated,
      fromBeginning: true,
    });

    await this.consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: (payload) => this.handleBatch(payload),
    });

    this.logger.log(
      `Consuming ${ExternalKafkaTopic.IdentityTenantCreated} as ${ExternalKafkaConsumerGroup.TenantProvisioner}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async handleBatch(payload: EachBatchPayload): Promise<void> {
    if (!payload.isRunning() || payload.isStale()) {
      return;
    }

    const events = payload.batch.messages
      .map((message) => this.parse(message.value))
      .filter((event): event is TenantCreatedEvent => event !== null);

    await this.tenantCreatedHandler.handleBatch(events);

    for (const message of payload.batch.messages) {
      payload.resolveOffset(message.offset);
    }
    await payload.heartbeat();
  }

  /** A record that cannot be parsed is dropped rather than wedging the partition. */
  private parse(value: Buffer | null): TenantCreatedEvent | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value.toString()) as TenantCreatedEvent;
    } catch (error) {
      this.logger.error('Skipping an unparseable tenant record', error);
      return null;
    }
  }
}
