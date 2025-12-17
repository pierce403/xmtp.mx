# AGENTS.md — Instructions for coding agents

## Self-Improvement Directive

Update this file when you learn something that would help the next agent (or future-you) work faster and safer.

Record:
- Wins: things that worked and should be repeated
- Misses: pitfalls, dead ends, and how to avoid them
- Collaborator signals: preferences about scope, tone, and review style

Keep entries concrete: exact commands, file paths, and specific symptoms/errors.

## Project Overview

`xmtp.mx` is a Gmail-like web UI for XMTP messaging. It’s deployed as a **static export** on GitHub Pages.

Key tech:
- Next.js App Router (static export)
- Tailwind CSS
- `thirdweb` for wallet connection
- `@xmtp/react-sdk` + `@xmtp/xmtp-js` for messaging
- `ethers` for ENS resolution

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
```

## Repo Structure

- `app/`: UI (XMTP runs client-side)
- `lib/`: shared helpers (thirdweb client, addressing, “email JSON” helpers)
- `bridge/`: SMTP↔XMTP bridge helpers (not deployable on GitHub Pages)
- `public/`: static assets (includes `.nojekyll` for Pages)
- `.github/workflows/pages.yml`: GitHub Pages deployment

## Conventions & Constraints

- This project targets **GitHub Pages**, so the build must remain **fully static**:
  - Don’t add Next route handlers like `app/api/**`
  - Don’t rely on server actions or runtime secrets in the UI
- For GitHub Pages project sites, set `NEXT_PUBLIC_BASE_PATH` to `/<repo>` during build.
- Prefer small, surgical changes; avoid refactors that don’t advance the requested behavior.

## Known Issues & Solutions

- XMTP/WASM + Server Components: importing XMTP code in a Server Component can break builds.
  - Keep XMTP usage in client components and load via `app/ClientOnly.tsx`.
- GitHub Pages needs `out/.nojekyll` so `_next/` assets are served.
- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` is baked at build time; missing/invalid values break wallet connect.

## Collaborator Signals (Pierce)

- Prefers concise updates and visible progress.
- Values “make it work end-to-end” over polishing.
- OK to commit/push when explicitly requested; otherwise, leave changes unpushed.

## Wins / Misses Log

### 2025-12-17
- Wins: Static export works (`npm run build` produces `out/`), basePath support via `NEXT_PUBLIC_BASE_PATH`, `.nojekyll` added.
- Wins: thirdweb wallet connect wired; banner warns when thirdweb client ID is missing/invalid.
- Misses: `next/dynamic(..., { ssr:false })` can’t be used in Server Components — use a client wrapper.

