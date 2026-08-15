# Architecture

Every component of the service and what state it is in. Kept beside the code so
it can be corrected in the same commit as the thing it describes.

| | Meaning |
|---|---|
| green | Built and verified on a running stack |
| amber | Scaffolded — exists, does no work yet |
| red, dashed | Not built; dashed edges are flows that do not run |

```mermaid
flowchart TD
    client(["Client<br/>bearer token carries sub + tenantId"])

    subgraph api["API process — src/main.ts"]
        direction TB
        guard["JwtStrategyGuard<br/>verifies JWT, puts tenantId in CLS"]
        ctl["Controllers<br/>conversations · messages · health"]
        uc["Use cases<br/>create conversation · create message · list messages"]
        repo["Tenant-scoped repositories<br/>every filter confined to the tenant"]
        searchuc["Search use case<br/>GET conversations/:id/messages/search"]
    end

    mongo[("MongoDB — replica set rs0<br/>conversations · messages<br/>indexes owned by migrations")]
    redis[("Redis<br/>health-checked, caches nothing yet")]
    dbz["Debezium on Kafka Connect<br/>unwrap envelope · re-key by conversation"]
    kafka[["Kafka — KRaft, no Zookeeper<br/>messaging.message-created.v1<br/>6 partitions · key = conversationId"]]
    consumer["Consumer — src/main.consumer.ts<br/>bulk index · coalesce lastMessageAt per batch"]
    es[("Elasticsearch<br/>one index, filtered alias per tenant<br/>content analysed · metadata flattened")]

    client -->|HTTPS| guard
    guard --> ctl
    ctl --> uc
    uc --> repo
    repo -->|one insert and keyset read| mongo
    repo -.->|liveness only| redis
    mongo -->|oplog| dbz
    dbz -->|publish| kafka
    kafka -.->|one partition per conversation| consumer
    consumer -.->|bulk index, doc id = message id| es
    consumer -.->|lastMessageAt| mongo
    ctl -.-> searchuc
    searchuc -.->|match and search_after| es

    classDef done fill:#e7f4ec,stroke:#17804a,stroke-width:2px,color:#11161d
    classDef wip fill:#fbf2df,stroke:#a2700a,stroke-width:2px,color:#11161d
    classDef todo fill:#fbeceb,stroke:#b23a2f,stroke-width:2px,color:#11161d
    classDef plain fill:#f2f4f7,stroke:#8b95a1,stroke-width:1px,color:#11161d

    class client plain
    class guard,ctl,uc,repo,mongo,dbz,kafka done
    class redis wip
    class consumer,es,searchuc todo
```

A message is written **once**, to MongoDB. Nothing publishes to Kafka on the
request path — Debezium reads the oplog instead, so there is no moment where the
message is stored but the event is lost. Everything below the Kafka topic, and
the search branch, is still a plan.

## Where each phase left off

| Phase | What it covers | Status |
|---|---|---|
| M0 | Template ported to MongoDB: tenant-scoped repositories, stateless JWT, CLS, logging, health check, three-mode test harness | done |
| M1 | Conversations and messages — cursor pagination, index migrations, authorisation, three endpoints | done |
| M2 | Kafka in KRaft mode, Debezium connector, the SMT chain, topic keyed by conversation | done |
| M3 | The Elasticsearch index schema — mapping, `dynamic: strict`, the apply step | not started |
| M3.1 | Bulk writes into the index, behind per-tenant aliases | not started |
| M3.2 | The consumer process that fills the index from the Kafka topic | not started |
| M3.3 | `search_after` queries and the search endpoint | not started |
| M3.4 | `lastMessageAt` on the conversation | not started |
| M4 | README for a cold reader, ADRs, domain glossary | not started |

M3 is split so each part can be reviewed on its own: the schema alone first, then
one thin slice at a time, each ending with something demonstrable. The reasoning
is in [PLAN.md](./PLAN.md#search--m3-through-m34).

Nothing is mid-flight: M2 closed and M3 has not opened, so no component is
genuinely in progress. Amber marks something narrower — a part that exists but
does no work yet.

## Known gaps

**Redis is the only amber component.** It is configured, health-checked and
proven reachable, but no use case caches anything through it. Caching is optional
in the brief.

**`pnpm start:consumer` is currently broken.** The script runs
`node dist/main.consumer` and that file does not exist yet — it arrives with M3.2.
Nothing else references it, so the failure is confined to anyone who runs that
one command.

**The topic name is written twice.** `KafkaTopic.MessageCreated` is injected into
the connector config by `scripts/register-debezium.ts`, so the producer cannot
drift from the consumer — but the collection name in
`infra/debezium/message-connector.json` is still a literal that has to match
`MESSAGES_COLLECTION`.

## Decisions

The reasoning behind each of these — and the trade-offs accepted — is in
[PLAN.md](./PLAN.md). The capacity numbers behind the Kafka partitioning choice
are in [back-of-envelope.md](./back-of-envelope.md).
