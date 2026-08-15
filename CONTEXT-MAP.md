# Context map

Two bounded contexts, one repository, one image. They are separate contexts because
they do not share a language: Identity's `User` is a person who can sign in;
Messaging's participant is a string it was told to remember.

## Contexts

- [Messaging](./src/messaging/CONTEXT.md) — conversations, messages, and search over them
- [Identity](./src/identity/CONTEXT.md) — tenants and the users who belong to them

Everything under `src/shared/` is a shared kernel: infrastructure both contexts sit
on, and nothing either of them owns. A context may use the kernel; it may not reach
into the other context. That is enforced by lint, not by convention — see
[ADR-007](./docs/adr/007-contexts-in-one-deployable.md).

## Relationships

**Identity → Messaging, by event.** Creating a tenant publishes
`identity.tenant-created.v1`. Messaging consumes it to provision the tenant's search
alias. Messaging never calls Identity, and Identity never touches Messaging's
storage.

**Identity → Messaging, by token.** Identity signs a JWT carrying the user, the
tenant and the roles; Messaging verifies the signature and reads the tenant from it.
This is the whole of their runtime coupling — a signing key and an agreed token
shape. No HTTP call passes between them.

**A participant id is not a foreign key.** Messaging stores whatever ids it is
given and never asks Identity whether they exist. A participant who is not a real
user produces a conversation nobody can read, which is a support question rather
than a corruption.

## Why one deployable

The exercise runs locally and one repository is what makes that convenient. At any
real scale these are separate services in separate repositories — nothing here
obstructs that, because there is no compile-time coupling to sever. The reasoning is
in [ADR-007](./docs/adr/007-contexts-in-one-deployable.md).
