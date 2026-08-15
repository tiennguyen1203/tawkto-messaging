/**
 * Creates the topics the service consumes, or leaves them alone if they already
 * exist. Idempotent, so it is safe on every deploy.
 *
 *   docker compose up -d kafka
 *   pnpm kafka:create-topics
 *
 * A separate step for the same reason `migrate:up` and `es:apply-templates` are:
 * topology is provisioning, not something a process should improvise at boot.
 *
 * Leaving it to be created implicitly does not work here. Kafka Connect creates
 * the topic when it produces its first record, which is later than the consumer's
 * first subscribe — and a consumer that subscribes to a topic that does not exist
 * yet dies with `UNKNOWN_TOPIC_OR_PARTITION`. Broker-side auto-creation is worse
 * still: it would silently make the topic with the broker's default partition
 * count rather than the six that per-conversation ordering depends on (D12).
 */
import { Kafka } from 'kafkajs';

import { MESSAGE_CHANGED_PARTITIONS } from '@/common/constants';
import { KafkaTopic } from '@/common/enums';

const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9094')
  .split(',')
  .map((broker) => broker.trim());

const main = async (): Promise<void> => {
  const kafka = new Kafka({ clientId: 'topic-provisioner', brokers: BROKERS });
  const admin = kafka.admin();

  console.log(`Connecting to ${BROKERS.join(', ')}`);
  await admin.connect();

  try {
    const created = await admin.createTopics({
      waitForLeaders: true,
      topics: [
        {
          topic: KafkaTopic.MessageChanged,
          numPartitions: MESSAGE_CHANGED_PARTITIONS,
          replicationFactor: 1,
        },
      ],
    });

    console.log(
      created
        ? `Created '${KafkaTopic.MessageChanged}' with ${MESSAGE_CHANGED_PARTITIONS} partitions`
        : `Topic '${KafkaTopic.MessageChanged}' already exists`,
    );

    const metadata = await admin.fetchTopicMetadata({
      topics: [KafkaTopic.MessageChanged],
    });
    for (const topic of metadata.topics) {
      console.log(`${topic.name}: ${topic.partitions.length} partitions`);
    }
  } finally {
    await admin.disconnect();
  }
};

void main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
