# ADR-001 — Several entrypoints over one `src/`, not a monorepo

**Status:** accepted · **Decides:** how the API and the indexer are packaged

## Context

The system is two processes that share almost everything. The API serves HTTP; the
indexer consumes Kafka and writes to Elasticsearch. They share configuration,
logging, the CLS setup, the tenant-scoped repositories and the models.

They differ in why they scale: the API by request rate, the indexer by consumer lag.
They should be deployable and restartable independently — an indexer crash-looping on
a poison record must not take the API down with it.

Nest offers monorepo mode for this: separate `apps/`, a shared `libs/`, per-app build
targets.

## Decision

One `src/`, one build, one image, several entrypoints:

| Entrypoint | Role |
|---|---|
| `src/main.ts` | HTTP API |
| `src/main.consumer.ts` | Kafka → Elasticsearch indexer |

`src/consumer.module.ts` imports the same `commonModules` the API does, plus the
consumer, and none of the HTTP layer. `createApplicationContext` rather than
`create`, because that process serves no HTTP.

Monorepo mode costs a few hours of configuration, and moving *into* one later is
cheap: the entrypoints are already separate files with separate module trees, so the
split is mechanical whenever a genuine reason appears — divergent dependency sets,
separate release cadences, more than a couple of processes.

## Consequences

**Both processes ship in one image.** They are the same artefact started with
different commands, which keeps their shared code exactly in step — a version skew
between an API that writes and an indexer that reads is impossible by construction.
It also means the indexer's image carries the HTTP dependencies it never loads, and a
change to either forces a redeploy of both.

**Nothing enforces the boundary.** In monorepo mode, an import from the API into the
consumer fails the build. Here it is a code review. The mitigation is that the shared
surface is explicit — `commonModules` is a named export, and each entrypoint's module
lists what it adds — so an import crossing the line is visible rather than incidental.

**The template already worked this way.** The `Aentry-v3-api` codebase this was
ported from uses the same pattern for its cron runners, so the harness, the
dependency scanner and the test helpers all already understand a tree with more than
one root.

**Deployment stays independent**, which was the actual requirement. Two services,
one image, different commands, separate scaling and separate restarts.
