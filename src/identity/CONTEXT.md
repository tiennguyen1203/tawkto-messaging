# Identity

Who exists, and which tenant they belong to. It answers one question for the rest of
the system: given a person, what token proves who they are?

## Language

**Tenant**:
An organisation whose data is isolated from every other organisation's. It is the
boundary Messaging scopes everything by, and Identity is where it comes into
existence.
_Avoid_: Account, organisation, workspace, customer

**User**:
A person who belongs to exactly one tenant and can be issued a token.
_Avoid_: Member, account, profile

**Token**:
The signed claim that a user is who they say, carrying the user, their tenant and
their roles. It is the only thing Identity hands to another context, and it is the
whole of what that context needs.
_Avoid_: Session, credential, JWT

**Role**:
A label on a user that a context may use to decide what they may do. Identity assigns
them and holds no opinion about what any of them mean.
_Avoid_: Permission, scope, claim

---

## Scope

This context exists to serve a local demonstration. It has no sign-in, no password,
no session and no refresh — a token is issued to whoever asks for one by name. That
is a deliberate limit of the exercise rather than a design position, and the
endpoints that create tenants and users say so in their own path.
