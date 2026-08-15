// Index migrations — see ADR-005. Indexes are created here and nowhere else:
// `autoIndex` is off in the mongoose config, so what these files declare is
// exactly what exists in the database.
//
// Migrations are plain CommonJS rather than TypeScript so that the same files
// load unchanged from the CLI and from inside jest, with no build step and no
// ts-node registration in between.

// The CLI does not load .env on its own — without this, MONGO_URI is undefined
// when `migrate-mongo up` runs from a shell.
require('dotenv').config({
  path: process.env.APP_ENV === 'test' ? '.env.test' : '.env',
});

const url = process.env.MONGO_URI;

// Deliberately no default. A fallback to localhost:27017 once sent this
// project's migrations into an unrelated MongoDB that happened to be running on
// that port — creating a database and an index inside someone else's data store,
// silently and successfully. Refusing to guess is the only safe behaviour.
if (!url) {
  throw new Error(
    'MONGO_URI is not set. migrate-mongo will not guess a connection string: ' +
      'pointing migrations at whichever MongoDB happens to be listening is how ' +
      'you end up writing into another project. Set it in .env, or export it.',
  );
}

// migrate-mongo wants the database name separately from the connection string.
const databaseName = (() => {
  const withoutQuery = url.split('?')[0];
  const name = withoutQuery.split('/').pop();

  if (!name) {
    throw new Error(`MONGO_URI has no database name: ${url}`);
  }

  return name;
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
