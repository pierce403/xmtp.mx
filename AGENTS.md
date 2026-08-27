# IMPORTANT

- After each meaningful change: `git commit` + `git push` (don’t leave work unpushed).
- Push directly to `main` and deploy the validated commit directly to production. Do not leave completed work only on staging or a preview unless Pierce explicitly asks for a staged rollout.

# AGENTS.md — Instructions for coding agents

## Self-Improvement Directive

Update this file when you learn something that would help the next agent (or future-you) work faster and safer.

Record:
- Wins: things that worked and should be repeated
- Misses: pitfalls, dead ends, and how to avoid them
- Collaborator signals: preferences about scope, tone, and review style

Keep entries concrete: exact commands, file paths, and specific symptoms/errors.

## Project Overview

`xmtp.mx` is a Gmail-like web UI for XMTP messaging. It is a **static export**
whose canonical target is Cloudflare Workers Static Assets. GitHub Pages is a
temporary rollback target during the staged migration.

Key tech:
- Next.js App Router (static export)
- Tailwind CSS
- `wagmi` + `viem` for wallet connection and direct account-bound signing
- `@xmtp/browser-sdk` for messaging
- `ethers` for ENS resolution

## Critical XMTP Reference (Read First)

- XMTP’s “LLM chat apps” pack: `https://raw.githubusercontent.com/xmtp/docs-xmtp-org/main/llms/llms-chat-apps.txt`
- When following XMTP docs, **use the right SDK code blocks**:
  - For `xmtp-js` in a browser: use samples marked **`[Browser]`**
  - For Node: use samples marked **`[Node]`**
- This repo is a **browser** app (Next.js static export). Avoid Node-only patterns in client code.

## Build & Test Commands

```bash
npm install

npm run dev
npm run lint

# Static export (outputs ./out)
npm run build

# Serve the static export locally
npm run start

# Build + serve
npm run preview

# Validate Cloudflare asset/config bundles without deploying
# (Wrangler 4.126.0 requires Node.js 22+.)
npm run cloudflare:dry-run:staging
npm run cloudflare:dry-run:production-candidate
npm run cloudflare:dry-run:production
```

## Repo Structure

- `app/`: UI (XMTP runs client-side)
- `lib/`: shared helpers (wagmi config, addressing, “email JSON” helpers)
- `bridge/`: legacy SMTP↔XMTP bridge helpers (not part of the static frontend)
- `public/`: static assets (`.nojekyll` remains only for the Pages fallback)
- `wrangler.jsonc`: isolated Cloudflare staging deployment
- `wrangler.production-preview.jsonc`: route-free production identity for immutable version uploads
- `wrangler.production.jsonc`: explicit production Custom Domain trigger
- `.github/workflows/cloudflare-frontend.yml`: guarded Cloudflare deployment
- `.github/workflows/pages.yml`: temporary GitHub Pages rollback deployment

## Conventions & Constraints

- This project targets **Workers Static Assets**, so the build must remain **fully static**:
  - Don’t add Next route handlers like `app/api/**`
  - Don’t rely on server actions or runtime secrets in the UI
- Cloudflare production and staging builds must use an empty
  `NEXT_PUBLIC_BASE_PATH`. Only the legacy Pages project-site fallback may set
  it to `/<repo>`.
- `wrangler.production.jsonc` attaches the real `xmtp.mx` hostname. Use staging,
  then upload and smoke-test an immutable version preview before exact-tag
  promotion. After cutover, never use a full `wrangler deploy` against
  `xmtp-mx-frontend`; it can change live traffic without testing the same
  version. Follow `docs/cloudflare-frontend.md` and never release from a
  non-main ref.
- Prefer small, surgical changes; avoid refactors that don’t advance the requested behavior.

## Known Issues & Solutions

- XMTP/WASM + Server Components: importing XMTP code in a Server Component can break builds.
  - Keep XMTP usage in client components and load via `app/ClientOnly.tsx`.
- GitHub Pages needs `out/.nojekyll` so `_next/` assets are served.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is optional and baked at build time. When unset, omit WalletConnect; never reuse another app's Reown project ID because its relay/origin policy can fail asynchronously.

## Collaborator Signals (Pierce)

- Prefers concise updates and visible progress.
- Values “make it work end-to-end” over polishing.
- Always commit and push after each meaningful change.
- Expects completed frontend changes to land on `main` and production by default; staging-only handoffs are not considered complete.

## Wins / Misses Log

### 2025-12-17
- Wins: Static export works (`npm run build` produces `out/`), basePath support via `NEXT_PUBLIC_BASE_PATH`, `.nojekyll` added.
- Wins: thirdweb wallet connect wired; banner warns when thirdweb client ID is missing/invalid.
- Wins: `npx --no-install next build` succeeds (Next 15.0.7).
- Misses: `next/dynamic(..., { ssr:false })` can’t be used in Server Components — use a client wrapper.
- Misses: A custom webpack `.wasm` loader (e.g. `wasm-loader`) can break wasm-pack’s `[Browser]` init path and throw `TypeError: e.replace is not a function` (webpack URL helper receiving non-string); fix by removing the custom `.wasm` loader and letting Next emit the `.wasm` as an asset URL, then call `await init()` with no args.
- Misses: The template workflow `.github/workflows/nextjs.yml` runs `actions/configure-pages` with `static_site_generator: next`, which mutates `next.config.js` and can introduce syntax errors (e.g. `SyntaxError: Unexpected string`); prefer the custom `.github/workflows/pages.yml` and delete/disable the template workflow.
- Misses: `@xmtp/react-sdk` hooks (e.g. `useClient()`) require `XMTPProvider` (wrap it in `app/Providers.tsx`); otherwise `setClient` is a no-op and the UI can hang on “Initializing XMTP…” forever.
- Misses: If you build via Docker as root (default), it can leave root-owned `.next/` + `out/` and later `rm -rf .next out` fails with `Permission denied`; run Docker with `--user \"$(id -u):$(id -g)\"` (or clean with `docker run --rm -v \"$PWD\":/app -w /app node:20-bullseye rm -rf out .next`).
- Misses: In Node 20 (fresh `npm ci`) you may see a build warning `Module not found: Can't resolve 'pino-pretty'` from `thirdweb`/WalletConnect; build still completes.

### 2025-12-18
- Wins: Merge conflict on `origin/copilot/sub-pr-10` resolved, verified via `npm run build`, then fast-forwarded into `main`.
- Wins: Demo modals are now anchored to the message list container (`app/XMTPWebmailClient.tsx`) with `absolute inset-2` and demo loads without auto-opening the welcome thread.
- Wins: Dependabot high fixed by overriding `viem` to `2.43.1` (see `package.json`), then `npm install` to update the lockfile.
- Wins: `npm audit` clean after overriding `@babel/helpers` to `7.28.4` and `brace-expansion` to `1.1.12` for `minimatch@3.1.2`.
- Wins: Demo modals are draggable/resizable with a 2/3-width minimum anchored to the message list (`app/XMTPWebmailClient.tsx`).
- Wins: Added console logs for demo modal open/close events to speed up UI debugging (`app/XMTPWebmailClient.tsx`).
- Wins: Demo modal sizing now initializes after `?demo` activates by observing the message list container with `ResizeObserver` (`app/XMTPWebmailClient.tsx`).
- Misses: Next’s lockfile detection can pick up a `bun.lock` in a parent dir (e.g. `/home/pierce/bun.lock`) and warn “Found multiple lockfiles”; remove/rename the parent lockfile (or build from a clean path) to avoid confusion.
- Misses: TypeScript can error on duplicate keys when spreading an object that includes `kind`/`id` into an object literal that also sets them; strip `kind` + `id` before spreading (see `app/XMTPWebmailClient.tsx` upsert helper).
- Misses: WalletConnect can log `Error: emitting session_request:<id> without any listeners` (from `@walletconnect/sign-client`) during thirdweb auto-connect; disable `autoConnect` on `ConnectButton` to stop the noisy auto-connect path.

### 2026-08-27
- Wins: A restrained, editorial visual system works better than layered glass effects for this mail UI; keep core surfaces flat, reserve violet for primary actions, and use `app-frame`, `landing-panel`, and the shared component presets in `app/globals.css`.
- Wins: Verify visual changes at 1440px and 412px, then run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e`; the suite covers responsive hierarchy, 44px primary action targets, wallet binding, navigation, search, dialogs, and viewport containment.
- Misses: Decorative text inside a connector button changes its accessible name; set an explicit `aria-label` such as `${wallet.name} Connect` so screen-reader and Playwright locators remain stable.
- Collaborator signal: Pierce explicitly requested “always push straight to main/prod”; after validation, publish directly to `main`, promote the exact SHA to production, and verify `https://xmtp.mx` rather than pausing at staging or an immutable preview.
- Misses: Reusing Converge's WalletConnect project ID on xmtp.mx caused `Connection interrupted while trying to subscribe` from WalletConnect Core and left XMTP binding waiting on the broken wallet transport. Only construct the WalletConnect connector when xmtp.mx has its own `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`; bound XMTP initialization so transport failures become retryable UI errors.

### 2026-08-27
- Wins: Cloudflare Workers Static Assets accepts the complete `out/` export (1,058 files in the final verified build); staging, production-preview, and cutover Wrangler configurations pass `wrangler deploy --dry-run`.
- Wins: Keep staging and production in separate Wrangler files so staging cannot claim `xmtp.mx`; upload production candidates with Workers Versions, verify the preview alias, and promote the exact version tag.
- Misses: A route-free full `wrangler deploy` still updates a production Worker that already has a Custom Domain. Use it only once for bootstrap; after cutover use `versions upload`, `versions deploy`, and `triggers deploy`.
- Misses: Wrangler initializes configured proxy handling even for `deploy --dry-run`. For a hermetic local dry run, unset `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their lowercase variants and set `WRANGLER_SEND_METRICS=false`.
- Misses: `xmtp.mx-relay` still contains an older cron-polling Worker, but the current Node relay needs an always-on XMTP listener and persistent `DATA_DIR`; do not treat the cron Worker as a drop-in replacement for Railway. Cloudflare Container disk is ephemeral, so prove restore/snapshot behavior and stable XMTP installation identity before migrating the relay.
- Misses: `xmtp.mx` currently has no public MX/TXT records. Copy the exact Mailgun records into Cloudflare before the nameserver cutover; never guess DKIM values or publish multiple SPF records.
- Wins: The `xmtp.mx` Custom Domain cutover succeeded after deleting the imported GitHub A records; authoritative DNS and direct HTTPS served Worker version `0fbbf498-9599-4b01-bf70-e71c4547eff4` with exact commit marker `c8e8545`.
- Misses: `wrangler triggers deploy` fails with code `100117` while externally managed apex A records exist. Delete the conflicting records, retry the trigger, then distinguish authoritative DNS from stale recursive caches before diagnosing a rollback.
- Wins: Tailwind 4 requires `@import "tailwindcss";` in `app/globals.css`; the old Tailwind 3 `@tailwind` directives silently omitted standard utilities and produced oversized SVGs and collapsed spacing in the rendered UI.
- Wins: `tests/e2e/frontend-ux.spec.ts` covers the landing page and demo inbox on desktop Chrome and a Pixel 7 viewport; run it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e` when the bundled browser is unavailable.
- Misses: A sandboxed Playwright preview can fail with `listen EPERM 0.0.0.0:3000`; rerun the same suite with permission to bind localhost rather than treating it as an application failure.
- Wins: `converge.cv` binds external wallets directly with wagmi account-bound `signMessage`, distinguishes EOA from SCW bytecode, creates XMTP with `disableAutoRegister: true`, and registers only when `client.isRegistered()` is false. `lib/wagmiConfig.ts` and `app/WalletConnectButton.tsx` carry that focused pattern here without the larger Converge onboarding system.
- Wins: Browser SDK 5.3.0 derives a stable default database name from environment plus inbox ID (`xmtp-<env>-<inboxId>.db3`), so reloading a wallet reuses its browser installation database instead of consuming a new XMTP installation each time.
- Misses: Converge's pnpm overrides pair `@wagmi/connectors@5.11.2` with `@wagmi/core@2.22.1`, but npm rejects that peer mismatch. The npm-compatible upgrade is `wagmi@2.17.5`, `@wagmi/connectors@5.11.2`, and `@wagmi/core@2.21.2`; keep all three exact-pinned and verify with `npm ls wagmi @wagmi/connectors @wagmi/core`.

### 2026-08-26
- Wins: Mobile wallet authorization can complete while Wagmi's `connectAsync()` remains pending. Persist only connector ID/name plus an attempt ID, then probe that exact connector on `pageshow`, visible `visibilitychange`, and focus; use the recovered connector for account-bound signing so XMTP registration continues immediately after the user returns.
- Misses: `useConnect().isPending` is mutation-wide, so rendering it in every connector row makes every wallet say “Opening…” at once. Track the selected connector UID locally and show `Waiting…` only on that row.
- Misses: Next/Webpack used-export optimization can emit a shared `@xmtp/wasm-bindings` enum table as `null` in the Browser SDK worker runtime, causing `Cannot read properties of null (reading 'indexOf')` before the signing request. Set `config.optimization.usedExports = false` for the client build and keep the mobile-return Playwright test as the regression check.
- Misses: `npm install --legacy-peer-deps` under npm 11 can write a lockfile that local builds accept but GitHub's npm 10 `npm ci` rejects as incomplete. Regenerate with `npx --yes npm@10.9.4 install --package-lock-only --ignore-scripts --no-audit --no-fund`, then prove it with the matching `npm ci --dry-run` command before pushing.
- Misses: Do not close over mutable `createdClient` in a React functional state updater and then set it to `null`; React may execute the updater later and crash on `null.inboxId`. Snapshot `initializedClient` and `initializedInboxId` before scheduling state updates, and transfer ownership only after those snapshots exist.
- Wins: Outbound SMTP compose uses the Cloudflare relay's public production inbox ID through `NEXT_PUBLIC_XMTP_RELAY_INBOX_ID` and sends the established `email.send.v1` JSON envelope over XMTP.
- Misses: This frontend is a static export, so Cloudflare Worker runtime variables cannot configure browser code. Put only the public relay inbox ID in the GitHub build variable; never put `XMTP_BOT_KEY` or any relay private key in `NEXT_PUBLIC_*`.
- Collaborator signal: Do not route new traffic through or configure Railway/Mailgun. Keep `NEXT_PUBLIC_CLOUDFLARE_RELAY_READY=false` until the Cloudflare relay owns the sole XMTP listener and native Email Service is verified.
