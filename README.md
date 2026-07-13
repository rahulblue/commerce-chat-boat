# Commerce Admin Chatbot

Standalone React + Node chatbot for admin users to ask operational questions about orders, returns, shipments, product sales, and sales summaries.

This app is intentionally separate from Adobe Commerce. The Node API owns the integration boundary and exposes safe commerce tools instead of letting the AI query Commerce directly.

## Structure

```text
commerce-admin-chatbot/
  client/   React admin chat UI
  server/   Node API, chat orchestrator, commerce tools
```

## Run Locally

```bash
cd commerce-admin-chatbot
npm install
npm run dev
```

The React app runs on `http://localhost:5173`.
The API runs on `http://localhost:4000`.

## Configuration

Copy the server env example:

```bash
cp server/.env.example server/.env
```

Without Adobe Commerce settings, the server uses mock data so the app works immediately.

Set these values when you are ready to connect to Commerce:

```env
ADOBE_COMMERCE_BASE_URL=https://your-commerce-domain.com
ADOBE_COMMERCE_ADMIN_TOKEN=your-admin-integration-token
```

Create the token in Adobe Commerce admin:

1. Go to `System > Extensions > Integrations`.
2. Add or open an integration with access to sales orders and shipments.
3. Activate it and copy the access token.
4. Put the token in `server/.env`.
5. Restart the Node server.

When the sidebar shows `Source: mock`, the app is not searching staging yet.
When it shows `Source: adobe-commerce-rest`, the app is reading Commerce REST data.

Optional AI response generation:

```env
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_MODEL=claude-opus-4-8
```

If `ANTHROPIC_API_KEY` is set, Claude runs a multi-turn tool-calling loop: it can call zero, one, or several approved tools in sequence (chaining results, e.g. look up a customer then their orders) before writing the final answer, up to 6 tool-call turns per question.

If `ANTHROPIC_API_KEY` is not set, the server still answers using deterministic regex-based tool routing and formatted tool results — this only matches a fixed set of anticipated phrasings and is meant as a fallback, not the primary experience.

## Chat Flow

```text
Admin question
  -> Claude decides whether to answer directly or call a tool, when ANTHROPIC_API_KEY is configured
  -> Node executes each requested tool against Adobe Commerce REST
  -> Claude may call more tools using earlier results, then writes the final answer
  -> React displays the answer and every tool used, with each one's data source
```

The AI does not receive database credentials and does not generate SQL.

## Current Tools

- Order lookup by increment ID
- Order list with optional status filter (pending, processing, complete, canceled, closed, holded, etc.), date range, `olderThanHours` (e.g. stuck-in-processing), coupon code, and sort (e.g. highest order value in a period)
- Customer order counts and order lists by exact name match
- Products purchased by a customer, with optional date range
- Shipment lookup by order increment ID
- Return/RMA lookup by RMA or order ID (reads Adobe Commerce's `/V1/rma-aging-report`)
- `rmaSummary`: aggregate RMA stats — counts by status/region, top returned SKUs, return-reason breakdown, RMAs open longer than a threshold, orders with multiple RMAs. See `dataNotes` in its response for what this report can't tell you (no true turnaround time, no customer identity, reason field often unpopulated).
- Top-selling products by date range (aggregated from live Commerce orders)
- Sales summary by date range, with optional status/coupon filter and promotion-usage % (aggregated from live Commerce orders)
- `topCustomers`: rank customers by order count or revenue over a window
- `ordersByRegion`: order count/revenue broken down by store/region (US, CA, DE, FR, UK, ...)
- `couponRevenue`: revenue and per-customer usage (incl. repeat use) for one coupon code
- `getStockStatus`: quantity, in-stock state, low-stock threshold, and enabled regions/websites for one named SKU (no catalog-wide OOS scan)
- Product lookup by SKU, or search by name/keyword
- Customer profile lookup (email, name, group, created date)
- Invoices and credit memos by order increment ID
- Store configuration (base currency, display currency, timezone, locale, base URL)
- Ingram / Ingram Micro configuration (requires the `/V1/seagate/chatbot/ingram-configuration` Commerce endpoint to be deployed; falls back to a "not connected yet" message otherwise)
- `queryCommerceApi`: catch-all for read-only Commerce data not covered above (promotions/cart price rules, coupons, customer groups, categories, etc.), restricted to an endpoint allowlist in `server/src/commerce/commerceTools.js` (`ALLOWED_QUERY_ENDPOINT_PREFIXES`)

All tools fall back to mock data (or a clear "not connected" message) when Adobe Commerce isn't configured or a specific endpoint isn't deployed yet.

### Known gaps (not buildable from Adobe Commerce REST alone)

- Catalog-wide OOS/at-risk-of-OOS scanning, and OOS ratio by country (no bulk low-stock report endpoint on this instance; only single-SKU lookups)
- Per-SKU/per-region Ingram Part Number, product price-change history, shipment failure tracking, Ingram back-order delay data
- Web analytics: conversion rate, cart abandonment, checkout drop-off, failed-payment spikes (needs GA4/Adobe Analytics or similar, not connected)
- Customer support/escalation data (needs a ticketing system integration, not connected)
- Commerce admin audit/change log (SKU change history, etc.)
- Real demand forecasting (the bot may do a naive same-day linear projection if asked, clearly labeled as an estimate)

### Known gap: cron/scheduled job execution status

Adobe Commerce's core REST API has no endpoint for cron job (`cron_schedule`) execution history, so the bot cannot answer "when did configuration X last run" out of the box. Closing this requires a custom Commerce module exposing that data over REST, the same way `/V1/seagate/chatbot/ingram-configuration` was added for Ingram — that's PHP/Commerce-module work outside this Node repo, not something addressable in `queryCommerceApi`'s allowlist alone. Until such an endpoint exists, the bot is instructed to say plainly that it can't answer these questions rather than guess.

## Safety Model

- The client never talks directly to Adobe Commerce.
- The AI never receives database credentials.
- The AI never generates SQL.
- The Node server only executes tools from a fixed registry; `queryCommerceApi` is the one flexible tool, and it is still deny-by-default — Claude can only pass an `endpoint`, and Node rejects anything outside a hardcoded prefix allowlist (no `..`, no `://`, no integrations/users/ACL/webapi paths) before making any request. GET-only; no write/delete endpoints are reachable from chat.
- Date ranges and result sizes are constrained in the tool layer.
