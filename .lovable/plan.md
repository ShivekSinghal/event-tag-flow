## Problem

You can't log in to the dashboard because the **app is failing to build**. The TypeScript compiler is reporting:

```
src/utils/nfc.ts(22,24): error TS2503: Cannot find namespace 'NodeJS'.
src/utils/nfc.ts(24,29): error TS2503: Cannot find namespace 'NodeJS'.
```

This means the bundle never loads cleanly, so the Auth page (and everything else) won't function properly. This was introduced by leftover edits — Supabase auth itself is fine, your user accounts are intact (e.g. `singhalshivek24@gmail.com` admin, `universal@hashtag.dance` admin, etc.).

## Root cause

`src/utils/nfc.ts` declares two private fields using `NodeJS.Timeout`:

```ts
private scanTimeout: NodeJS.Timeout | null = null;
private progressInterval: NodeJS.Timeout | null = null;
```

`NodeJS` is a Node-only namespace and isn't available in this browser/Vite project's TypeScript config, so the typecheck fails and the build breaks.

## Fix

Replace both `NodeJS.Timeout` types with the browser-safe equivalents:

```ts
private scanTimeout: ReturnType<typeof setTimeout> | null = null;
private progressInterval: ReturnType<typeof setInterval> | null = null;
```

This is the standard cross-environment way to type timer handles and works in both browser and Node without needing `@types/node`.

## Files changed

- `src/utils/nfc.ts` — update lines 22 and 24 only.

## Expected outcome

- TypeScript build succeeds.
- The Auth page loads correctly.
- You can sign in and reach the Dashboard again with your existing admin credentials.

No database changes, no auth config changes needed.