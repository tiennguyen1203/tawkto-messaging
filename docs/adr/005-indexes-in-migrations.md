# ADR-005 — Indexes live in migrations, `autoIndex` off

**Status:** accepted · **Decides:** where index definitions live and when they are applied

## Context

Mongoose and typegoose can declare indexes on the model and build them at
connection time. It is the default, it keeps the definition next to the field, and
it is a production hazard.

Building an index is an unbounded blocking operation on a large collection. Doing it
at process start means a deploy of a stateless API can stall or lock the database,
and every replica attempts it at once. Worse is the quiet failure: a schema that
declares an index the database does not actually have. Queries still return correct
answers, just by scanning — and nothing reports it, because a full collection scan
is not an error.

## Decision

`autoIndex: false` in every environment. Index definitions live in `migrations/`,
applied by `pnpm migrate:up` as a deploy step, and nowhere else. Models carry a
comment naming the migration that owns their indexes rather than an `@index()`
decorator, because declaring in two places invites the two to disagree.

Migrations do not run on boot, for the same reason indexes are not built on boot:
several processes would race, and a migration that fails should stop a deploy rather
than a request.

Tests run the same migration files, so specs exercise the indexes production has.

## Consequences

**Models lose their self-documenting quality.** Reading `MessageModel` no longer
tells you how it is queried; you follow the comment to the migration. The trade is
accepted: one source of truth that is occasionally inconvenient beats two that can
drift.

**A forgotten migration is a silent performance regression.** Adding a query without
adding its index produces correct, slow answers. The mitigation is a spec that runs
`explain()` and asserts the winning plan is an `IXSCAN` — and that spec is the reason
this ADR exists in the form it does.

**That spec once passed vacuously, which is the most useful thing in this record.**
Typegoose pluralises the class name, so `MessageModel` became `messagemodels` while
the migration indexed `messages`. The application was running full collection scans
and nothing complained. The spec passed too — it explained a query against the
hardcoded `messages`, an empty collection that did have the index, and `IXSCAN` on an
empty collection is still `IXSCAN`. Two mistakes cancelled out into a green test.

The fix was both halves: collection names are now pinned on the model
(`MESSAGES_COLLECTION`) rather than derived, and the spec derives the collection it
inspects from `repository.collectionName`, so an assertion can never again be aimed
at a collection the application does not use. It was found in M2, when Debezium
watched `messaging.messages` and no event ever arrived.

**Migrations are plain CommonJS**, so the same files load unchanged from the CLI and
from inside jest, with no build step between them.

**Not only indexes.** The same file type now carries the `collMod` that enables
change stream pre-images on the messages collection — a collection-level setting the
Debezium connector depends on, which belongs with the schema rather than in a README
step someone forgets.
