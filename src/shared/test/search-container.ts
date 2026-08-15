/* eslint-disable no-console */
import {
  ElasticsearchContainer,
  StartedElasticsearchContainer,
} from '@testcontainers/elasticsearch';
import * as fs from 'fs';

/**
 * One Elasticsearch container for the whole jest run, started in globalSetup
 * beside the MongoDB one and shared through a temp file.
 *
 * Elasticsearch is a JVM and costs far more to start than MongoDB, so the two
 * are started concurrently — the run pays the slower of the pair, not the sum.
 */
export class SearchContainer {
  private static container: StartedElasticsearchContainer;

  private static get filePath(): string {
    const shard = process.env.SHARD ?? 'default';
    return `/tmp/es-config-${encodeURIComponent(shard)}.json`;
  }

  static async init() {
    this.container = await new ElasticsearchContainer(
      'docker.elastic.co/elasticsearch/elasticsearch:8.15.3',
    )
      .withEnvironment({
        'xpack.security.enabled': 'false',
        'discovery.type': 'single-node',
        ES_JAVA_OPTS: '-Xms512m -Xmx512m',
        'cluster.routing.allocation.disk.threshold_enabled': 'false',
      })
      .withStartupTimeout(180_000)
      .start();

    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ node: this.container.getHttpUrl() }),
    );
  }

  static async clear() {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err) {
      console.error(`Error deleting ${this.filePath}: `, err);
    }

    await this.container?.stop();
  }

  static getNode(): string {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return (JSON.parse(raw) as { node: string }).node;
  }
}
