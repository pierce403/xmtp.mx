# xmtp.mx

A Gmail-like webmail UI, but backed by the XMTP network.

- Wallet connection: `thirdweb`
- Messaging: `@xmtp/react-sdk` / `@xmtp/xmtp-js`
- “Email” payloads: JSON blobs sent over XMTP

## Local-first

This is a **client-only** app (static export). The UX is “local-first”:

- Messages are end-to-end encrypted on the XMTP network.
- Once fetched + decrypted, `@xmtp/react-sdk` caches conversations/messages in **browser storage** (IndexedDB via Dexie), scoped by wallet address.
- That local cache enables fast rendering and offline browsing (and future offline search) of previously synced messages.
- Note: the cache contains **decrypted** message content (not additional “at rest” encryption). Clear site data to wipe it.

## Local dev

```bash
npm install
cp .env.example .env
npm run dev
```

Then open `http://localhost:3000`.

### Required env

- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`: required for wallet connect.
- Optional (recommended): `NEXT_PUBLIC_MAINNET_RPC_URL` for ENS resolution when composing to `deanpierce.eth@xmtp.mx`.

### Preview the static export

```bash
npm run preview
```

### Browser UX tests

The Playwright suite exercises the landing page and demo inbox at desktop and
Pixel 7 sizes. It uses the installed Chrome channel by default; environments
with a known Chrome binary can override it explicitly.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

## Cloudflare Workers Static Assets

This repo remains a static export (`next.config.js` uses `output: 'export'`),
but the canonical hosting target is Cloudflare Workers Static Assets. The
production export is served from the domain root, so
`NEXT_PUBLIC_BASE_PATH` must be empty.

Build and validate the staged Worker locally:

```bash
npm ci
NEXT_PUBLIC_BASE_PATH= npm run build
npm run cloudflare:dry-run:staging
```

`wrangler.jsonc` deploys an isolated `workers.dev` staging Worker.
`wrangler.production-preview.jsonc` uploads immutable versions of the
route-free production Worker; each candidate is tested through a version
preview alias. `wrangler.production.jsonc` is applied only with
`wrangler triggers deploy` to attach the `xmtp.mx` Custom Domain during the
approved initial cutover. See
[`docs/cloudflare-frontend.md`](docs/cloudflare-frontend.md) for credentials,
GitHub Environments, smoke tests, cutover, and rollback.

The Cloudflare workflow always validates pushes but deployment is manual until
the staging and production smoke tests pass. After cutover, it promotes only
the exact version tested at the preview alias. The previous GitHub Pages
workflow remains temporarily as a rollback path; it should be removed only
after Cloudflare production is verified.

Workers Static Assets is static hosting, so there are **no** Next.js API routes
or runtime secrets in this build.

## SMTP → XMTP bridge (WIP)

The static frontend does not run email handlers. The forwarding helper in
`bridge/inbound-email.ts` is retained for compatibility; production mail and
XMTP relay logic belongs in the separately deployed relay architecture.

### How address mapping works

- `deanpierce.eth@xmtp.mx` → `deanpierce.eth` (resolved via ENS) → sent on XMTP to that address
- `0xabc...@xmtp.mx` → `0xabc...` → sent on XMTP to that address
- Anything not `@xmtp.mx` currently returns an error (SMTP delivery is not implemented yet)

## Message format

Compose + replies send a JSON “email” message over XMTP:

- `lib/xmtpEmail.ts`
