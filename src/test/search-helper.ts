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
 */
export class SearchHelper {
  private _client?: Client;

  get client(): Client {
    if (!this._client) {
      throw new Error('SearchHelper.setUp() has not run yet');
    }
    return this._client;
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

    if (!(await this.client.indices.exists({ index: MESSAGES_INDEX }))) {
      await this.client.indices.create({ index: MESSAGES_INDEX });
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

  /** Empties the index between tests while keeping the mapping and aliases. */
  async cleanUp(): Promise<void> {
    await this.client.deleteByQuery({
      index: MESSAGES_INDEX,
      query: { match_all: {} },
      refresh: true,
      conflicts: 'proceed',
    });
  }

  async tearDown(): Promise<void> {
    await this._client?.close();
    this._client = undefined;
  }
}
