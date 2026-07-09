# CDN bundle (`react-scan-banihani`)

`react-scan-banihani.js` in this folder is the browser IIFE build of `packages/scan`
(a copy of `packages/scan/dist/auto.global.js`, which self-initializes on load and
includes the "Copy AI prompt" inspector feature).

It lives here — outside the git-ignored `dist/` — so it can be committed and served
straight from GitHub via jsDelivr, with no npm publish.

## Regenerate after changing the library

```bash
pnpm build:cdn        # builds packages/scan, then copies the bundle here
git add cdn/react-scan-banihani.js && git commit -m "chore: update cdn bundle"
git push
```

## Use it in an app

```jsx
{process.env.NODE_ENV === "development" && (
  <Script
    src="//cdn.jsdelivr.net/gh/<your-user>/react-scan-banihani@main/cdn/react-scan-banihani.js"
    crossOrigin="anonymous"
    strategy="beforeInteractive"
  />
)}
```

- `@main` — tracks your default branch, cached by jsDelivr for ~12h (fine for dev).
- `@v0.5.7` (a git tag) or `@<commit-sha>` — immutable, cached permanently (use for prod).
- The GitHub repo must be **public** for jsDelivr `/gh/` to serve it.
