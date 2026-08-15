import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import * as migrateMongo from 'migrate-mongo';
import { DatabaseContainer } from './database-container';

/**
 * Gives each test file its own database inside the shared container, so files can
 * run in parallel without seeing each other's documents.
 */
export class DatabaseHelper {
  private client?: MongoClient;
  private dbName!: string;
  uri!: string;

  async createDatabase() {
    this.dbName = `test_${randomUUID().replace(/-/g, '')}`;
    this.uri = withDatabase(
      DatabaseContainer.getConnectionString(),
      this.dbName,
    );

    // Everything downstream — getMongooseConfig(), migrate-mongo — reads the URI
    // from the environment, so setting it here is what pins them to this database.
    process.env.MONGO_URI = this.uri;

    this.client = new MongoClient(this.uri);
    await this.client.connect();
  }

  /**
   * Applies the same migrations production runs, so tests exercise the real
   * indexes rather than a schema-inferred approximation. See ADR-005.
   */
  async runMigrations() {
    migrateMongo.config.set({
      mongodb: {
        url: this.uri,
        databaseName: this.dbName,
        options: {},
      },
      migrationsDir: 'migrations',
      changelogCollectionName: 'changelog',
      migrationFileExtension: '.js',
      useFileHash: false,
      moduleSystem: 'commonjs',
    });

    const { db, client } = await migrateMongo.database.connect();
    try {
      await migrateMongo.up(db, client);
    } finally {
      await client.close();
    }
  }

  /** Empties every collection between tests while keeping indexes intact. */
  async cleanUpDb() {
    if (!this.client) return;

    const db = this.client.db(this.dbName);
    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();

    await Promise.all(
      collections
        .filter((c) => c.name !== 'changelog')
        .map((c) => db.collection(c.name).deleteMany({})),
    );
  }

  async dropDatabase() {
    if (!this.client) return;

    await this.client.db(this.dbName).dropDatabase();
    await this.client.close();
    this.client = undefined;
  }
}

/**
 * `directConnection=true` is not optional here.
 *
 * MongoDBContainer runs a replica set, and its connection string points at the
 * mapped host port. Without directConnection the driver performs replica-set
 * discovery, learns the member's advertised hostname — the container id, e.g.
 * `a1fc41d54702` — and then fails with ENOTFOUND, because that name only
 * resolves inside the Docker network. directConnection skips discovery and talks
 * to the mapped port; change streams still work, since they need the replica set
 * to exist, not to be discovered.
 */
const withDatabase = (uri: string, dbName: string): string => {
  const [base, query] = uri.split('?');
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;

  const params = new URLSearchParams(query);
  params.set('directConnection', 'true');

  return `${trimmed}/${dbName}?${params.toString()}`;
};
