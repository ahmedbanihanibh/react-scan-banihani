# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

`AGENTS.md` (repo root) is the authoritative style guide — it defines the mandatory TypeScript/Preact/signals conventions (interfaces over types, arrow functions, kebab-case files, no-comments default, `constants.ts` for magic numbers, effect-classification rules). Follow it. This file covers architecture and commands that AGENTS.md does not.

## Commands

Run at the repo root (Turbo orchestrates across the workspace). **`pnpm build` must complete before `test`, `test:e2e`, `lint`, or `typecheck`** — Turbo enforces `dependsOn: ["^build"]`, and the website/extension/kitchen-sink all depend on `react-scan#build`.

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Build (all publishable pkgs) | `pnpm build` |
| Dev watch (`react-scan` + kitchen-sink) | `pnpm dev` |
| Unit tests (Vitest via vite-plus) | `pnpm test` |
| Single unit test | `cd packages/scan && vp test run src/core/fast-serialize.test.ts` |
| E2E (Playwright → kitchen-sink on :5173) | `pnpm test:e2e` (needs `npx playwright install chromium --with-deps`) |
| Lint / fix | `pnpm lint` / `pnpm lint:fix` (oxlint) |
| Format / check | `pnpm format` / `pnpm format:check` (oxfmt) |
| Typecheck | `pnpm typecheck` |
| Everything (lint+fmt+typecheck) | `pnpm check` |

Toolchain is [Vite+](https://viteplus.dev) (`vp` = lint/fmt/test/check) with `turbo` on top; the `vite`/`vitest` packages are overridden to `@voidzero-dev/vite-plus-*` in root `package.json`. Node ≥22, pnpm ≥8. The `pnpm.onlyBuiltDependencies` allowlist (`@parcel/watcher`, `esbuild`, `sharp`, `spawn-sync`, `unrs-resolver`) is required or native build steps are skipped and installs break.

## Monorepo layout

- **`packages/scan`** — the `react-scan` npm package (core library + CLI). This is where almost all work happens.
- **`packages/extension`** — `@react-scan/extension`, the Chrome/Firefox/Brave browser extension. Depends on `react-scan` workspace build.
- **`packages/vite-plugin-react-scan`** — `@react-scan/vite-plugin-react-scan`, a thin Vite plugin wrapper (single `src/index.ts`).
- **`packages/website`** — `@react-scan/website`, the Next.js docs/demo site. `presync` copies `packages/scan/dist/auto.global.js` into `public/`.
- **`kitchen-sink/`** — Vite app used as the Playwright E2E target (port 5173, auto-started by `playwright.config.ts`).
- **`e2e/`** — Playwright specs. **`docs/installation/`** — per-framework install guides.

## Core library architecture (`packages/scan`)

React Scan instruments React's fiber tree via **[bippy](https://github.com/aidenybai/bippy)** (the RDT hook), detects re-renders, and paints an overlay UI. The overlay is a **Preact app in a Shadow DOM** driven by `@preact/signals` — not React state.

**Entry points** (`src/*.ts`, each a separate tsup bundle):
- `src/index.ts` — main npm entry; imports polyfills + bippy side-effect, re-exports `core/index`.
- `src/auto.ts` — the CDN/`auto.global.js` IIFE build that self-initializes on load.
- `src/install-hook.ts` — installs the RDT hook as early as possible.
- `src/lite/index.ts` — a lighter build with its own profiling hooks (`create-profiling-hooks.ts`, `walk-fiber.ts`).

**`src/core/`** — instrumentation engine.
- `instrumentation.ts` — the heart: wraps bippy's `instrument`/`traverseRenderedFibers`, computes `Render` data, classifies `RenderPhase` (Mount/Update/Unmount), and collects prop/state/context `Change`s.
- `index.ts` — public API + global state (`ReactScanInternals`, `Options`), and `initRootContainer()` which creates `#react-scan-root` and attaches the Shadow DOM. **Always mount overlay UI under this shadow root, never `document.body`.**
- `notifications/` — event tracking + the highlight/outline canvas overlay.

**`src/new-outlines/`** — the render-highlight renderer, using an **OffscreenCanvas web worker** (`offscreen-canvas.worker.ts`, bundled via `worker-plugin.ts`) to draw outlines off the main thread.

**`src/web/`** — the Preact overlay UI. Path aliases: `~web/*` → `src/web/*`, `~core/*` → `src/core/*` (see `tsconfig.json`). JSX uses `jsxImportSource: preact` — use `className`, not `class`. Notable subtrees: `views/toolbar`, `views/inspector` (`components-tree`, `whats-changed`, `timeline`, `overlay`), `views/notifications`, `utils/helpers.ts` (`cn`, `readLocalStorage`/`saveLocalStorage`), `assets/css` (Tailwind → compiled `styles.css`, imported as a string into the shadow root).

**`src/react-component-name/`** — a build-time **unplugin** (via Babel) that preserves component display names in production bundles, so React Scan can label components. Ships adapters for every bundler: `vite.ts`, `webpack.ts`, `rollup.ts`, `rspack.ts`, `rolldown.ts`, `esbuild.ts`, `astro.ts` (see `typesVersions` in `package.json`).

**CLI** — `bin/cli.js` → `dist/cli`; spins up a Playwright browser to scan any URL (`npx react-scan <url>`).

### Build specifics
- `tsup.config.ts` produces multiple bundles; `auto`/CDN targets **ES2019** (no `?.`/`??`) for old babel-loader compat (#287/#336), and prepends a `'use client';` directive to chunks for RSC compatibility. `react`/`react-dom`/`next`/`react-router` are externalized.
- CSS is built separately: `pnpm build:css` runs `postcss` on `styles.tailwind.css` → `styles.css` before the JS build.
- Module-level signals exported from tree-shaken bundles must be wrapped `/* @__PURE__ */ signal(...)` (see AGENTS.md).

## Releases

Changesets-based. `pnpm changeset` to add a changeset, `pnpm version` to bump, `pnpm release` (build + `changeset publish`) to publish. The extension has its own `pack:{chrome,firefox,brave}` scripts.
