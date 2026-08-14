import { MongooseModuleOptions } from '@nestjs/mongoose';

/**
 * `autoIndex` is off everywhere, including tests.
 *
 * Indexes are owned by the files in `migrations/` and applied by `yarn migrate:up`
 * as an explicit deploy step. Letting mongoose build indexes from the schema at
 * process start would build them at runtime — an unbounded, blocking operation on
 * a large collection — and would silently diverge from what the migrations say is
 * there. Tests run the same migrations, so they exercise the real indexes.
 */
export const getMongooseConfig = (): MongooseModuleOptions & {
  uri: string;
} => ({
  uri: process.env.MONGO_URI!,
  autoIndex: false,
  autoCreate: true,
  // Fail fast instead of buffering commands for 10s when the primary is gone.
  serverSelectionTimeoutMS: 5_000,
  maxPoolSize: 20,
});
