# CARVE_CE_HYDROGEN

A Shopify Hydrogen project for **Carve Designs**. The storefront itself is **not publicly browsable** — this app currently runs only as a webhook receiver on Oxygen.

## Current state: webhook-only

Every request is hard-blocked with `503 Service unavailable` except paths under `/webhooks/*`, which are allowed through. This is enforced at the top of the fetch handler in [`server.ts`](./server.ts), before Hydrogen builds any request context (storefront client, cart, session, etc.), so blocked requests do no extra work.

Because the storefront pages aren't served, the standard Hydrogen skeleton routes and UI components (home, product/collection pages, cart, account, search, blogs, policies, sitemap, robots.txt, `PageLayout`/`Header`/`Footer`, etc.) have been removed. `app/root.tsx` is a bare HTML shell with no layout or storefront queries. `app/lib` and `app/graphql` still contain some Hydrogen scaffolding (session, cart fragment, customer-account queries) that isn't currently wired to anything, kept in case the storefront is re-enabled later.

### Existing webhook: Okendo

[`app/routes/webhooks.okendo.tsx`](./app/routes/webhooks.okendo.tsx) receives `survey_response` webhooks from Okendo (post-purchase surveys):

1. Verifies the payload's Svix signature (`webhook-id` / `webhook-timestamp` / `webhook-signature` headers) against `OKENDO_WEBHOOK_SECRET`.
2. Formats each answered question into a Triple Whale PPS (Post-Purchase Survey) record.
3. Forwards the records to Triple Whale's Data-In API (`TRIPLE_WHALE_API_KEY`) for attribution analytics, fire-and-forget via `context.waitUntil`.

### Adding a new webhook

Add a route file under `app/routes/webhooks.<name>.tsx`. No changes to `server.ts` are needed — the allowlist matches any path under `/webhooks/`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `OKENDO_WEBHOOK_SECRET` | Svix signing secret used to verify incoming Okendo webhooks |
| `TRIPLE_WHALE_API_KEY` | API key for posting PPS records to Triple Whale |
| `PUBLIC_STORE_DOMAIN` | Shop domain, sent as the `shop` field in Triple Whale PPS records |
| `SESSION_SECRET` | Required by Hydrogen's session setup in `app/lib/context.ts` |

## Commands

```bash
npm run dev         # Local dev via Shopify CLI (Hydrogen + Oxygen emulator)
npm run build       # Production build (Vite + codegen)
npm run preview     # Serve the production build locally
npm run typecheck   # react-router typegen + tsc --noEmit
npm run codegen     # Regenerate GraphQL types from storefront/customer-account schemas
npm run lint        # ESLint
```

Deploys to Shopify Oxygen.
