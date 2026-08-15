import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachBatchPayload, Kafka } from 'kafkajs';

import { KafkaConsumerGroup, KafkaTopic } from '@/messaging/common/enums';
import { MessageChangeHandler } from './handler';
import { MessageChangeEvent } from './message-changed.event';

/**
 * Subscribes to the CDC topic and hands whole batches to the handler.
 *
 * Deliberately kafkajs rather than `@nestjs/microservices`: its Kafka transport
 * delivers one message per handler call, and bulk indexing is not an
 * optimisation here — a per-document consumer tops out around 220 messages a
 * second and becomes the pipeline's ceiling (D22). `eachBatch` is the only way to
 * get the batch that bulk indexing needs.
 */
@Injectable()
export class MessageChangeConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MessageChangeConsumer.name);
  private consumer?: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly messageChangeHandler: MessageChangeHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    const kafka = new Kafka({
      clientId: KafkaConsumerGroup.MessageSearchIndexer,
      brokers: this.configService
        .getOrThrow<string>('KAFKA_BROKERS')
        .split(',')
        .map((broker) => broker.trim()),
    });

    this.consumer = kafka.consumer({
      groupId: KafkaConsumerGroup.MessageSearchIndexer,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: KafkaTopic.MessageChanged,
      fromBeginning: true,
    });
    // Subscribing to a topic that does not exist fails this process on purpose.
    // The alternative is auto-creation with the broker's default partition count,
    // which would silently give up the per-conversation ordering six partitions
    // buy (D12). `pnpm kafka:create-topics` is the step that should have run.

    await this.consumer.run({
      // Offsets are resolved by hand below, once the batch is durably indexed.
      eachBatchAutoResolve: false,
      eachBatch: (payload) => this.handleBatch(payload),
    });

    this.logger.log(
      `Consuming ${KafkaTopic.MessageChanged} as ${KafkaConsumerGroup.MessageSearchIndexer}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    // Disconnecting cleanly lets the group rebalance immediately rather than
    // waiting for the session timeout to expire.
    await this.consumer?.disconnect();
  }

  /**
   * The payload is taken whole rather than destructured: its callbacks are
   * standalone functions bound to the batch, and pulling them out of the object
   * is what `@typescript-eslint/unbound-method` exists to complain about.
   */
  private async handleBatch(payload: EachBatchPayload): Promise<void> {
    // A rebalance can hand this partition to someone else mid-batch; finishing
    // it would mean two consumers writing the same offsets.
    if (!payload.isRunning() || payload.isStale()) {
      return;
    }

    const events = payload.batch.messages
      .map((message) => this.parse(message.value))
      .filter((event): event is MessageChangeEvent => event !== null);

    await this.messageChangeHandler.handleBatch(events);

    // Only now. A crash before this point replays the batch, which is safe: the
    // document id is the message id, so re-indexing overwrites rather than
    // duplicates.
    for (const message of payload.batch.messages) {
      payload.resolveOffset(message.offset);
    }
    await payload.heartbeat();

    this.logger.debug('Consumed a Kafka batch', {
      partition: payload.batch.partition,
      messages: payload.batch.messages.length,
    });
  }

  /**
   * A record that cannot be parsed is dropped with a log rather than throwing:
   * one malformed message must not wedge the partition behind it forever.
   */
  private parse(value: Buffer | null): MessageChangeEvent | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value.toString()) as MessageChangeEvent;
    } catch (error) {
      this.logger.error('Skipping an unparseable record', error);
      return null;
    }
  }
}
