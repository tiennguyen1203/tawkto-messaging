// Index migrations — see ADR-005. Indexes are created here and nowhere else:
// `autoIndex` is off in the mongoose config, so what these files declare is
// exactly what exists in the database.
//
// Migrations are plain CommonJS rather than TypeScript so that the same files
// load unchanged from the CLI and from inside jest, with no build step and no
// ts-node registration in between.

const url = process.env.MONGO_URI ?? 'mongodb://localhost:27017/messaging';

// migrate-mongo wants the database name separately from the connection string.
const databaseName = (() => {
  const withoutQuery = url.split('?')[0];
  const name = withoutQuery.split('/').pop();
  return name || 'messaging';
})();

module.exports = {
  mongodb: {
    url,
    databaseName,
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
