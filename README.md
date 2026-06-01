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
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4.1-mini
```

If `OPENAI_API_KEY` is set, OpenAI chooses from the approved tool list, Node executes the selected Commerce REST tool, and OpenAI summarizes the returned data.

If `OPENAI_API_KEY` is not set, the server still answers using deterministic tool routing and formatted tool results.

## Chat Flow

```text
Admin question
  -> OpenAI selects one approved tool, when OPENAI_API_KEY is configured
  -> Node executes that tool against Adobe Commerce REST
  -> OpenAI summarizes only the returned tool result
  -> React displays the answer, tool name, and data source
```

The AI does not receive database credentials and does not generate SQL.

## Current Tools

- Order lookup by increment ID
- Recent order list
- Shipment lookup by order increment ID
- Return/RMA lookup by RMA or order ID
- Top-selling products by date range
- Sales summary by date range

## Safety Model

- The client never talks directly to Adobe Commerce.
- The AI never receives database credentials.
- The AI never generates SQL.
- The Node server selects from a fixed tool registry.
- Date ranges and result sizes are constrained in the tool layer.
