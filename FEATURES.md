# xmtp.mx - Features

## Features

### Static Export (Cloudflare Workers Static Assets)

- **Stability**: stable
- **Description**: Builds to static HTML/CSS/JS via Next.js static export and serves from Cloudflare Workers Static Assets.
- **Properties**:
  - `next.config.js` uses `output: 'export'` and `trailingSlash: true`
  - Uses an empty `NEXT_PUBLIC_BASE_PATH` at `xmtp.mx`
  - Writes build output to `out/`
  - Uses SSG-aware `404-page` and automatic trailing-slash handling
- **Test Criteria**:
  - [x] `npm run build` generates `out/index.html`
  - [x] All three Wrangler configurations pass a dry-run asset upload

### Cloudflare Frontend Deployment (GitHub Actions)

- **Stability**: in-progress
- **Description**: Deploys the static export first to an isolated staging Worker, then to the `xmtp.mx` Workers Custom Domain after approval.
- **Properties**:
  - Workflow: `.github/workflows/cloudflare-frontend.yml`
  - `wrangler.jsonc` cannot claim the production hostname
  - `wrangler.production-preview.jsonc` uploads immutable versions of the production Worker without a zone route
  - Candidate versions are live-tested through unique preview aliases before exact-tag promotion
  - `wrangler.production.jsonc` explicitly attaches only `xmtp.mx` through a one-time trigger deployment
  - Builds with an empty base path, repository browser-config secrets, and protected deployment environments
  - Push deployment is gated by `CLOUDFLARE_FRONTEND_AUTO_DEPLOY=true`
  - Production targets reject non-main refs and require the protected production environments
  - `CLOUDFLARE_FRONTEND_CUTOVER_COMPLETE` blocks the one-time bootstrap after hostname attachment
  - Every deployment receives a commit-specific live Cloudflare-header/content smoke test
- **Test Criteria**:
  - [x] Staging, version-preview, and cutover configuration files exist
  - [ ] Staging `workers.dev` deployment passes wallet/XMTP smoke tests
  - [ ] Production preview passes the same smoke tests from `main`
  - [ ] `https://xmtp.mx/` serves the verified production deployment

### GitHub Pages Rollback

- **Stability**: deprecated
- **Description**: The former Pages workflow is retained only until the Cloudflare production deployment is verified.
- **Properties**:
  - `.github/workflows/pages.yml` and `public/.nojekyll` remain during cutover
  - Removal is an explicit post-verification step in the runbook
- **Test Criteria**:
  - [ ] Cloudflare production is healthy before the fallback is removed

### Thirdweb Wallet Connection

- **Stability**: in-progress
- **Description**: Connects a user wallet via thirdweb and uses it to initialize XMTP.
- **Properties**:
  - Uses `ThirdwebProvider` + `ConnectButton`
  - Requires `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` (baked at build time)
  - Shows a prominent banner when the client ID is missing or rejected by thirdweb RPC
- **Test Criteria**:
  - [ ] With a valid `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`, the Connect button opens and completes a connection
  - [ ] With a missing/invalid client ID, the banner renders at the top

### XMTP Inbox UI (Gmail-like)

- **Stability**: in-progress
- **Description**: Shows a Gmail-like layout: sidebar, inbox list, thread view, compose modal.
- **Properties**:
  - Inbox list is backed by XMTP conversations cache
  - Thread view renders decoded messages and supports replies
  - Search filters conversations (currently by peer address)
- **Test Criteria**:
  - [x] Landing and demo flows pass Playwright on desktop Chrome and a Pixel 7 viewport
  - [x] Demo navigation, search, compose validation, modal dismissal, and viewport containment are covered
  - [ ] With an XMTP-enabled wallet, conversations list loads
  - [ ] Selecting a conversation shows its thread
  - [ ] Sending a reply appends to the thread

### “Email JSON” Message Format (v1)

- **Stability**: stable
- **Description**: A simple JSON envelope sent over XMTP to mimic email fields (subject/body/from/to).
- **Properties**:
  - Encoder/decoder live in `lib/xmtpEmail.ts`
  - Non-JSON messages still render as plain text (fallback)
- **Test Criteria**:
  - [x] Encoding produces JSON with `v: 1` and `type: "email"`
  - [x] Decoding falls back to text for non-matching payloads

### Compose to `@xmtp.mx` Recipients

- **Stability**: in-progress
- **Description**: Compose supports `name@xmtp.mx` mapping and ENS resolution for peer addressing.
- **Properties**:
  - `deanpierce.eth@xmtp.mx` maps to peer `deanpierce.eth` and resolves via ENS
  - `0x…@xmtp.mx` maps directly to the 0x address
  - Non-`@xmtp.mx` recipients are treated as SMTP (not yet implemented)
- **Test Criteria**:
  - [ ] Composing to `0x...@xmtp.mx` sends a JSON email message on XMTP
  - [ ] Composing to `deanpierce.eth@xmtp.mx` resolves via ENS and sends on XMTP

### SMTP → XMTP Bridge Library

- **Stability**: deprecated
- **Description**: A legacy helper for forwarding inbound SMTP email payloads to XMTP; production delivery belongs to the separate Cloudflare relay.
- **Properties**:
  - `bridge/inbound-email.ts` exports forwarding logic
  - It is not bundled into or executed by the static frontend
- **Test Criteria**:
  - [ ] Remove after Cloudflare inbound delivery is verified end-to-end

### Cloudflare Mail Relay Integration

- **Stability**: in-progress
- **Description**: The separate relay receives Internet mail through Cloudflare Email Routing and delivers outbound mail through Cloudflare Email Service.
- **Properties**:
  - The browser wire formats and address mapping remain unchanged
  - Mail, Queue, D1, Container, and secret configuration is owned by `pierce403/xmtp.mx-relay`
  - No relay secret or privileged endpoint is exposed by this static Worker
- **Test Criteria**:
  - [ ] Sending an email to `*.@xmtp.mx` results in an XMTP message to the mapped peer
  - [ ] An allowlisted XMTP sender receives `email.send.result.v1` after outbound delivery
