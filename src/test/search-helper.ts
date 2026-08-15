import { Client } from '@elastic/elasticsearch';
import * as fs from 'fs';
import * as path from 'path';

import { MESSAGES_INDEX } from '@/common/constants';
import { SearchContainer } from './search-container';

/**
 * Gives a spec a real Elasticsearch with the production mapping applied.
 *
 * The template comes from the same file `pnpm es:apply-templates` uses, so a
 * mapping mistake fails here rather than in production — a hand-written test
 * mapping would only ever confirm itself.
 *
 * Spec files run in parallel workers against one container and one index, so
 * every helper is given a namespace and hands out tenant ids under it. The tenant
 * is the isolation unit in production too, which is what makes this work without
 * the index name becoming a test-shaped parameter: documents never collide,
 * aliases never collide, and a file only ever deletes or counts its own.
 */
export class SearchHelper {
  private _client?: Client;

  constructor(private readonly namespace: string) {}

  get client(): Client {
    if (!this._client) {
      throw new Error('SearchHelper.setUp() has not run yet');
    }
    return this._client;
  }

  /** A tenant id no other spec file will use. */
  tenant(name: string): string {
    return `${this.namespace}-${name}`;
  }

  /**
   * A document id no other spec file will use.
   *
   * Namespacing the tenant is not enough: `_id` is global to the index, so two
   * files both writing `m1` overwrite each other's document, and the alias filter
   * then hides the survivor from whichever tenant lost. That failure reads as an
   * empty result set, not as a conflict.
   */
  id(name: string): string {
    return `${this.namespace}-${name}`;
  }

  /** Strips the namespace back off, so assertions can name ids plainly. */
  plain(id: string): string {
    return id.startsWith(`${this.namespace}-`)
      ? id.slice(this.namespace.length + 1)
      : id;
  }

  async setUp(): Promise<void> {
    const node = SearchContainer.getNode();
    process.env.ELASTICSEARCH_NODE = node;
    this._client = new Client({ node });

    const template = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../infra/elasticsearch/message-index.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    delete template._comment;

    await this.client.indices.putIndexTemplate({
      name: 'messages',
      ...(template as object),
    });

    // Spec files run in parallel workers, so two of them can find the index
    // missing and both try to create it. Losing that race is not a failure —
    // the loser wanted the index to exist, and it does.
    try {
      await this.client.indices.create({
        index: MESSAGES_INDEX,
        // The one place the tests deliberately differ from production, which
        // ships a single shard. Routing only exists across shards: with one,
        // a write addressed to the concrete index instead of the tenant's
        // alias lands on the same shard either way and every test still
        // passes, while in a sharded cluster the same code answers
        // `not_found` and leaves a deleted message searchable. Three shards
        // make that observable here instead of in production.
        settings: { number_of_shards: 3 },
      });
    } catch (error) {
      if (!/resource_already_exists/.test(JSON.stringify(error))) {
        throw error;
      }
    }
  }

  /**
   * Makes everything written so far visible to search.
   *
   * Production does not refresh on write — the index does it on its own second
   * by second, and paying for a forced refresh per batch would cost exactly what
   * bulk indexing is there to save. A test cannot wait a second between arrange
   * and assert, so visibility is the spec's business to ask for, explicitly.
   */
  async refresh(): Promise<void> {
    await this.client.indices.refresh({ index: MESSAGES_INDEX });
  }

  /** How many documents this spec file has in the shared index. */
  async count(): Promise<number> {
    const { count } = await this.client.count({
      index: MESSAGES_INDEX,
      query: this.mine,
    });
    return count;
  }

  /** Empties this spec file's documents, leaving the mapping and other files' alone. */
  async cleanUp(): Promise<void> {
    await this.client.deleteByQuery({
      index: MESSAGES_INDEX,
      query: this.mine,
      refresh: true,
      conflicts: 'proceed',
    });
  }

  async tearDown(): Promise<void> {
    await this._client?.close();
    this._client = undefined;
  }

  private get mine() {
    return { prefix: { tenantId: `${this.namespace}-` } };
  }
}
