/**
 * migrate-mongo ships no type declarations. Only the surface the test harness
 * and the CLI wrapper actually use is declared here.
 */
declare module 'migrate-mongo' {
  import type { Db, MongoClient } from 'mongodb';

  export type MigrateMongoConfig = {
    mongodb: {
      url: string;
      databaseName?: string;
      options?: Record<string, unknown>;
    };
    migrationsDir: string;
    changelogCollectionName: string;
    migrationFileExtension?: string;
    useFileHash?: boolean;
    moduleSystem?: 'commonjs' | 'esm';
  };

  export const config: {
    set(config: MigrateMongoConfig): void;
    read(): Promise<MigrateMongoConfig>;
  };

  export const database: {
    connect(): Promise<{ db: Db; client: MongoClient }>;
  };

  export function up(db: Db, client: MongoClient): Promise<string[]>;
  export function down(db: Db, client: MongoClient): Promise<string[]>;
  export function status(
    db: Db,
  ): Promise<{ fileName: string; appliedAt: string }[]>;
}
