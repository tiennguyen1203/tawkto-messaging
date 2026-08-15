/**
 * Applies the message index template and creates the concrete index, or leaves
 * both alone if they already match. Idempotent, so it is safe on every deploy.
 *
 * A separate step rather than something the API or the consumer does at boot,
 * for the same reason migrations are: several replicas would race, and a mapping
 * that failed to apply should stop a deploy rather than a request.
 *
 *   docker compose up -d elasticsearch
 *   pnpm es:apply-templates
 */
import * as fs from 'fs';

import {
  MESSAGE_INDEX_TEMPLATE_PATH,
  MESSAGES_INDEX,
} from '@/messaging/common/constants';

const ES_NODE = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';
const TEMPLATE_NAME = 'messages';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const call = async (
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${ES_NODE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
};

const waitForElasticsearch = async (attempts = 60): Promise<void> => {
  process.stdout.write(`Waiting for Elasticsearch at ${ES_NODE} `);

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${ES_NODE}/_cluster/health`);
      if (res.ok) {
        const health = (await res.json()) as { status: string };
        if (health.status === 'green' || health.status === 'yellow') {
          process.stdout.write(` ${health.status}\n`);
          return;
        }
      }
    } catch {
      // not up yet
    }
    process.stdout.write('.');
    await sleep(2_000);
  }

  throw new Error(`\nElasticsearch never became reachable at ${ES_NODE}`);
};

const main = async (): Promise<void> => {
  const file = JSON.parse(
    fs.readFileSync(MESSAGE_INDEX_TEMPLATE_PATH, 'utf8'),
  ) as Record<string, unknown>;
  delete file._comment;

  await waitForElasticsearch();

  const template = await call('PUT', `/_index_template/${TEMPLATE_NAME}`, file);
  if (template.status >= 300) {
    throw new Error(`Applying the template failed: ${template.text}`);
  }
  console.log(`Applied index template '${TEMPLATE_NAME}'`);

  // Creating the index is what materialises the template's mapping. Doing it
  // here rather than letting the first write auto-create it means a mapping
  // mistake surfaces at deploy time, not on a user's request.
  const created = await call('PUT', `/${MESSAGES_INDEX}`);
  if (
    created.status === 400 &&
    created.text.includes('resource_already_exists')
  ) {
    console.log(`Index '${MESSAGES_INDEX}' already exists`);
  } else if (created.status >= 300) {
    throw new Error(`Creating ${MESSAGES_INDEX} failed: ${created.text}`);
  } else {
    console.log(`Created index '${MESSAGES_INDEX}'`);
  }

  const mapping = await call('GET', `/${MESSAGES_INDEX}/_mapping`);
  const fields = Object.keys(
    (
      JSON.parse(mapping.text) as Record<
        string,
        { mappings: { properties: Record<string, unknown> } }
      >
    )[MESSAGES_INDEX].mappings.properties,
  );
  console.log(`Mapped fields: ${fields.join(', ')}`);
};

void main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
