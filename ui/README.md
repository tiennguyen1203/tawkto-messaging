# Demo UI

A client of the two services, and not a bounded context. It exists so a reviewer can
become somebody without reaching for `curl`.

**Deliberately outside the pnpm workspace**, with its own manifest and lockfile.
`src/` is one TypeScript program with `rootDir: src` and a `.vue` file in it breaks
the server build; a separate manifest also keeps Vue and Vite out of the dependency
graph the API image installs from.

```bash
pnpm --dir ui install
pnpm ui:dev        # from the repository root
```

Vite proxies `/api` to identity, so development is same-origin and needs no CORS.
See PLAN §10b for why that is a proxy rather than a gateway.
