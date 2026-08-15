/* eslint-disable no-console */
import {
  MongoDBContainer,
  StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import * as fs from 'fs';

/**
 * One MongoDB container for the whole jest run, started in globalSetup and shared
 * by every test file through a temp file holding its connection string.
 *
 * MongoDBContainer starts the server as a single-node replica set and runs
 * rs.initiate() for us — which is what the application needs anyway, since change
 * streams (the CDC source) require a replica set.
 */
export class DatabaseContainer {
  private static container: StartedMongoDBContainer;

  private static get filePath(): string {
    const shard = process.env.SHARD ?? 'default';
    return `/tmp/mongo-config-${encodeURIComponent(shard)}.json`;
  }

  static async init() {
    this.container = await new MongoDBContainer('mongo:7.0').start();

    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ uri: this.container.getConnectionString() }),
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

  static getConnectionString(): string {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return (JSON.parse(raw) as { uri: string }).uri;
  }
}
