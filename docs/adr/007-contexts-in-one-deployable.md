# ADR-007 — Bounded contexts in one deployable, boundaries enforced by lint

**Status:** accepted · **Decides:** how Messaging and Identity are separated, and how that separation is kept honest

## Context

The brief asks for DDD. It also asks for a messaging service, and nothing else —
there is no requirement for tenants or users. But `tenantId` currently appears out
of thin air inside a hand-signed JWT, and something has to own the concepts of a
tenant and a user for that to mean anything. Identity is a second bounded context:
it does not share a language with Messaging, and neither reads the other's data.

The obvious reading of "DDD" is to make it a second service behind an API gateway.
That reading conflates two things. **DDD is about bounded contexts and a ubiquitous
language; it says nothing about deployment topology.** A context can be a module in
one process. Splitting into a service is a packaging decision, and splitting *in
order to demonstrate DDD* inverts the reasoning.

## Decision

Two contexts, `src/messaging/` and `src/identity/`, in one repository and one
image. Each gets its own process by adding an entrypoint — the codebase already
runs `main.ts` and `main.consumer.ts` this way (ADR-001), so a third costs a file
and a script, not a build system.

`common/`, `infra/` and `health-check/` are a **shared kernel** the contexts sit on.
Neither context imports the other, and that is enforced rather than agreed:
`no-restricted-imports` in `eslint.config.mjs` fails `pnpm lint` on any import
crossing the boundary, naming the file and what to do instead.

**This is a choice made for the shape of the exercise.** The work runs locally to
serve a code test, and one repository is what makes that convenient — one install,
one test suite, one compose file. **A team at any real scale should split these into
separate services in separate repositories**, at which point identity is deployed and
versioned on its own and Messaging reaches it, if at all, over the network. Nothing
here obstructs that: the contexts already have no compile-time coupling to sever.

## Consequences

**The runtime coupling is already nil, which is why the split stays cheap.** Identity
signs a JWT; Messaging verifies a signature. No HTTP call, no shared transaction,
no reading of each other's collections. What crosses the boundary is a signing key
and a token shape — the cleanest relationship two contexts can have, and the reason
"extract to a service later" is a deployment change rather than a rewrite.

**The shared kernel is the expensive relationship.** `BaseRepository`,
`TenantScopedRepository`, `CachingService`, the CLS module and `BaseUseCase` are used
by both. Changing any of them changes both contexts at once. That is the standard
cost of a shared kernel and it is accepted deliberately — but it is the thing to
watch, and the reason the kernel holds infrastructure rather than domain concepts.

**One MongoDB, separate collections.** Two contexts on one database is usually an
anti-pattern. It is tolerable only because neither reads the other's collections —
a condition to preserve, not an accident to rely on.

**`TenantScopedRepository` does not fit Identity's write path.** It reads the tenant
from CLS and throws when there is none, which is correct everywhere except where a
tenant is being *created* — at that moment there is no tenant in scope. Identity's
provisioning path therefore sits outside the scoping machinery, on purpose.

**No API gateway.** There is no frontend to serve and nothing to route between; a
reverse proxy in front of two local processes would be configuration nobody
exercises. It becomes worth adding when there is a client that needs one origin.
