# xmtp.mx - Features

## Features

### Static Export (GitHub Pages)

- **Stability**: stable
- **Description**: Builds to static HTML/CSS/JS via Next.js static export and serves from GitHub Pages.
- **Properties**:
  - `next.config.js` uses `output: 'export'` and `trailingSlash: true`
  - Supports GitHub Pages project sites via `NEXT_PUBLIC_BASE_PATH` (usually `/<repo>`)
  - Writes build output to `out/`
  - Includes `.nojekyll` so `_next/` assets work on Pages
- **Test Criteria**:
  - [x] `npm run build` generates `out/index.html`
  - [x] `out/.nojekyll` exists

### GitHub Pages Deployment (GitHub Actions)

- **Stability**: in-progress
- **Description**: Deploys the static export to GitHub Pages using a GitHub Actions workflow.
- **Properties**:
  - Workflow: `.github/workflows/pages.yml`
  - Builds with `NEXT_PUBLIC_BASE_PATH=/<repo>`
  - Uses repo secrets for build-time public env vars
- **Test Criteria**:
  - [x] Workflow file exists at `.github/workflows/pages.yml`
  - [ ] A workflow run succeeds and publishes the site

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

- **Stability**: in-progress
- **Description**: A reusable helper for forwarding inbound SMTP email payloads to XMTP (not hosted on GitHub Pages).
- **Properties**:
  - `bridge/inbound-email.ts` exports forwarding logic
  - Intended to be deployed separately (Worker, serverless, etc.)
- **Test Criteria**:
  - [ ] A deployed bridge accepts a webhook payload and forwards to XMTP

### SMTP Mail Delivery + MX Routing

- **Stability**: planned
- **Description**: Receive SMTP emails (e.g., `deanpierce.eth@xmtp.mx`) via MX + webhook provider, then forward to XMTP.
- **Properties**:
  - Requires DNS + an inbound email provider (Mailgun/SendGrid/etc.)
  - Requires a hosted bridge endpoint (not GitHub Pages)
- **Test Criteria**:
  - [ ] Sending an email to `*.@xmtp.mx` results in an XMTP message to the mapped peer

