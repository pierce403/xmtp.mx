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

## GitHub Pages (static)

This repo is configured for a static export (`next.config.js` uses `output: 'export'`) and deploys to GitHub Pages via `.github/workflows/pages.yml`.

Setup:

1. In your repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**
2. Add repo secrets (optional but recommended):
   - `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`
   - `NEXT_PUBLIC_MAINNET_RPC_URL`
3. Push to `main` (or run the workflow manually)

Note: GitHub Pages is static hosting, so there are **no** Next.js API routes in this build.

## SMTP → XMTP bridge (WIP)

GitHub Pages can’t run a webhook, but the forwarding logic is kept in `bridge/inbound-email.ts` so you can deploy it separately (Cloudflare Worker, a tiny Node server, etc).

### How address mapping works

- `deanpierce.eth@xmtp.mx` → `deanpierce.eth` (resolved via ENS) → sent on XMTP to that address
- `0xabc...@xmtp.mx` → `0xabc...` → sent on XMTP to that address
- Anything not `@xmtp.mx` currently returns an error (SMTP delivery is not implemented yet)

## Message format

Compose + replies send a JSON “email” message over XMTP:

- `lib/xmtpEmail.ts`
