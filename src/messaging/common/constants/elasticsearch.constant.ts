import * as path from 'path';

/**
 * The one concrete index every tenant's messages live in.
 *
 * Versioned in the name so a mapping change that cannot be applied in place is a
 * reindex into `messages-v2` followed by repointing aliases, rather than an
 * outage. See ADR-003.
 */
export const MESSAGES_INDEX = 'messages-v1';

/**
 * The index template both `pnpm es:apply-templates` and the test harness apply,
 * so a mapping change cannot pass the suite and fail in production.
 *
 * Resolved from the repository root rather than by counting `../` from whichever
 * file is asking — a relative hop count is a dependency on the directory layout,
 * and it broke silently the first time a file moved.
 */
export const MESSAGE_INDEX_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../..',
  'infra/elasticsearch/message-index.json',
);

/**
 * The only name the application ever uses to read or write a tenant's messages.
 *
 * Today it resolves to a filtered alias over the shared index: Elasticsearch
 * applies `tenantId` and the routing value itself, so isolation does not depend
 * on every query remembering a filter — the same reason repository queries are
 * scoped by the repository rather than by their callers.
 *
 * It is also the single seam to change if the shared index is ever split: point
 * the alias at a dedicated index per tenant and no application code moves.
 */
export const messageAliasFor = (tenantId: string): string =>
  `messages-${tenantId}`;
