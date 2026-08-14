# Testing Conventions

## Naming: when / should

Every test reads as a specification sentence, assembled from its nesting:

| Level | Form | Example |
|---|---|---|
| Outer `describe` | the unit under test | `@workflows/message/create-message` |
| Inner `describe` | the method or route, when there is one | `#POST /api/v1/messages` · `#findOne` |
| Scenario `describe` | `when <condition>` | `when the sender is not a participant` |
| `it` | `should <observable outcome>` | `should refuse with permission denied` |

```ts
describe('@workflows/message/create-message', () => {
  describe('when the sender is not a participant', () => {
    it('should refuse with permission denied', () => {
      // ...
    });
  });
});
```

Read together this is *"when the sender is not a participant, should refuse with
permission denied"* — a failure report states the broken behaviour without
anyone needing to open the file.

Two rules follow from it:

- **Group by condition, not by mechanics.** `when the conversation belongs to
  another tenant` is a scenario; `with mocked repository` is not.
- **`it` describes behaviour, never implementation.** "should return 404" is a
  behaviour; "should call findByIdInTenant" is a description of how today's code
  happens to work, and it breaks on refactors that change nothing observable.

## What gets tested where

| Layer | Mode | Database |
|---|---|---|
| `workflows/` use cases | `TestHelper.lightweightMode(UseCase)` | real MongoDB in testcontainers |
| `routers/` controllers | `TestHelper.lightweightMode(Controller)` | real MongoDB, real guard chain |
| module wiring | `TestHelper.fullAppMode()` | real MongoDB, whole AppModule |

Integration tests run against a real MongoDB rather than a mocked driver: the
behaviour worth protecting here — tenant scoping, keyset pagination, index usage
— only exists in the interaction with the database, and a mock would assert our
own assumptions back at us.

## Proving a test is not vacuous

A test that cannot fail is worse than no test, because it reads like coverage.
For the assertions load-bearing enough to matter, break the implementation
deliberately and confirm the test goes red. Two in this repository have been
checked that way:

- **Keyset tie-breaking** — removing the `_id` comparison from the cursor filter
  turns exactly one test red (`should not lose or repeat messages that share a
  timestamp`).
- **Index migration** — narrowing the compound index to `{ tenantId: 1 }` turns
  two red, including the `explain()` assertion that catches a collection scan.
