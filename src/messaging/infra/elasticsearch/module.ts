import { Client } from '@elastic/elasticsearch';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MessageSearchIndex } from './message-search.index';

/**
 * Imported explicitly by whoever needs the index rather than declared global:
 * today that is the consumer process alone, and the API has no reason to hold a
 * connection to Elasticsearch until the search endpoint arrives.
 */
@Module({
  providers: [
    {
      provide: Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Client({
          node: config.getOrThrow<string>('ELASTICSEARCH_NODE'),
          // Fail fast rather than hold a batch open while the cluster is
          // unreachable; a rejected batch is replayed, a hung one is not.
          requestTimeout: 5_000,
          maxRetries: 2,
        }),
    },
    MessageSearchIndex,
  ],
  exports: [MessageSearchIndex, Client],
})
export class SearchModule {}
