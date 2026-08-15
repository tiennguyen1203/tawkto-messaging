/**
 * Registers the Debezium connector with Kafka Connect, or updates it in place if
 * it already exists. Idempotent, so it is safe to run on every deploy.
 *
 * Deliberately a separate step rather than something the API does at boot: the
 * connector is infrastructure, several API replicas would race to install it, and
 * a failed registration should stop a deploy rather than a request.
 *
 * Written in TypeScript so it can import the topic name and partition count from
 * the same place the consumer reads them. Those two keys are absent from the
 * connector JSON on purpose — there is one source of truth, so the producer
 * cannot drift from the consumer.
 */
import * as fs from 'fs';
import * as path from 'path';

import { MESSAGE_CHANGED_PARTITIONS } from '@/messaging/common/constants';
import { KafkaTopic } from '@/messaging/common/enums';

type ConnectorFile = {
  name: string;
  config: Record<string, string>;
};

const CONNECT_URL = process.env.KAFKA_CONNECT_URL ?? 'http://localhost:8083';
const CONFIG_PATH = path.join(
  __dirname,
  '../infra/debezium/message-connector.json',
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const reachable = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${CONNECT_URL}/connectors`);
    return res.ok;
  } catch {
    return false;
  }
};

const waitForConnect = async (attempts = 60): Promise<void> => {
  process.stdout.write(`Waiting for Kafka Connect at ${CONNECT_URL} `);

  for (let i = 0; i < attempts; i += 1) {
    if (await reachable()) {
      process.stdout.write(' ready\n');
      return;
    }
    process.stdout.write('.');
    await sleep(2_000);
  }

  throw new Error(`\nKafka Connect never became reachable at ${CONNECT_URL}`);
};

const buildConfig = (file: ConnectorFile): Record<string, string> => ({
  ...file.config,
  // Injected rather than duplicated in the JSON.
  'transforms.route.replacement': KafkaTopic.MessageChanged,
  'topic.creation.default.partitions': String(MESSAGE_CHANGED_PARTITIONS),
});

const statusOf = async (name: string): Promise<string> => {
  try {
    const res = await fetch(`${CONNECT_URL}/connectors/${name}/status`);
    if (!res.ok) return 'UNKNOWN';

    const body = (await res.json()) as {
      connector: { state: string };
      tasks?: { state: string }[];
    };
    const tasks = body.tasks?.map((t) => t.state).join(',') || 'none';
    return `${body.connector.state}/${tasks}`;
  } catch {
    return 'UNKNOWN';
  }
};

const main = async (): Promise<void> => {
  const file = JSON.parse(
    fs.readFileSync(CONFIG_PATH, 'utf8'),
  ) as ConnectorFile;

  await waitForConnect();

  // PUT /config is upsert semantics; POST /connectors would 409 on a second run.
  const res = await fetch(`${CONNECT_URL}/connectors/${file.name}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildConfig(file)),
  });

  if (!res.ok) {
    throw new Error(`Registration failed (${res.status}): ${await res.text()}`);
  }

  console.log(
    `Registered '${file.name}' -> ${KafkaTopic.MessageChanged} ` +
      `(${MESSAGE_CHANGED_PARTITIONS} partitions). Waiting for RUNNING ...`,
  );

  for (let i = 0; i < 30; i += 1) {
    const state = await statusOf(file.name);
    console.log(`  connector/tasks: ${state}`);

    if (state === 'RUNNING/RUNNING') return;

    if (state.includes('FAILED')) {
      const detail = await fetch(
        `${CONNECT_URL}/connectors/${file.name}/status`,
      );
      throw new Error(`Connector or task failed:\n${await detail.text()}`);
    }

    await sleep(2_000);
  }

  throw new Error('Connector did not reach RUNNING in time.');
};

void main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
