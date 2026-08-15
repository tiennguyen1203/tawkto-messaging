# Architecture decision records

One file per decision that would be expensive to reverse, or that a reader would
otherwise assume was an accident.

Each records the trade-off it accepted, not just the choice — a decision with no
cost attached is usually a decision nobody actually made. Where a decision was
reversed, the record says so rather than being deleted; the reasoning that led
there is the part worth keeping.

| # | Decision | Status |
|---|---|---|
| [001](./001-multi-entrypoint.md) | Several entrypoints over one `src/`, not a monorepo | Accepted |
| [002](./002-cdc-not-outbox.md) | Change data capture instead of a transactional outbox | Accepted |
| [002b](./002b-hot-partition-risk.md) | Accepting the hot-partition risk of keying by `conversationId` | Accepted |
| [003](./003-shared-index-tenant-aliases.md) | One Elasticsearch index, a filtered alias per tenant | Accepted |
| [004](./004-cursor-pagination.md) | Cursor pagination, and no exact `total` | Accepted |
| [005](./005-indexes-in-migrations.md) | Indexes live in migrations, `autoIndex` off | Accepted |
| [006](./006-ordering-by-server-timestamp.md) | Ordering by server `timestamp` with `_id` as tiebreaker | Accepted |
| [007](./007-contexts-in-one-deployable.md) | Bounded contexts in one deployable, boundaries enforced by lint | Accepted |

The numbered decisions in [PLAN.md §2](../PLAN.md) (D1–D43) are the finer-grained
running log — every choice made along the way, including ones too small for a
record of their own. These eight are the ones a reader needs to understand the
shape of the system.
