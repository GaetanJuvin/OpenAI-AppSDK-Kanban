# Kanban MCP Server (Apps SDK Tutorial)

This repo follows the structure from [Set up your server](https://developers.openai.com/apps-sdk/build/mcp-server) in the OpenAI Apps SDK docs. It bundles a tiny kanban component and an MCP server that exposes a single tool wired to that component.

## Project layout

- `src/server.ts` – TypeScript MCP server built with `@modelcontextprotocol/sdk`.
- `web/dist/kanban.{js,css}` – Static component bundle returned by the MCP resource.
- `dist/` – Transpiled JavaScript after `npm run build`.

## Prerequisites

- Node.js 20+
- npm (ships with Node)

Install dependencies once:

```bash
npm install
```

## Run locally

1. Build the component bundle (already checked in under `web/dist`, update and rebuild as needed).
2. Start the MCP server:
   ```bash
   npm run dev
   ```
   The server listens on `http://localhost:3333/mcp` and exposes a `/health` probe.
3. Point [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) at the local endpoint, list tools, and invoke `kanban-board`. Inspector verifies that the response includes structured content plus component metadata and renders the kanban widget inline.
   - To add a new task, call the same tool with a `newTask` payload, for example:
     ```json
     {
       "name": "kanban-board",
       "arguments": {
         "newTask": {
           "title": "Kickoff marketing plan",
           "assignee": "Grace",
           "status": "in-progress"
         }
       }
     }
     ```
     The server stores the task in-memory, echoes a confirmation message, and returns the refreshed board.

To ship production assets, compile with:

```bash
npm run build
npm run start
```

## How it works

- The MCP server registers the `ui://widget/kanban-board@v4.html` resource with `mimeType: text/html+skybridge`, sending the pre-built HTML that bootstraps the component bundle.
- The `kanban-board` tool returns `structuredContent`, optional textual `content`, and `_meta` payload. `_meta.openai/outputTemplate` links the tool to the component. Passing a `newTask` object in the tool arguments persists the task in-memory and includes the updated board in the response.
- The component reads `window.openai.toolOutput` to hydrate the kanban DOM and updates automatically when Inspector (or ChatGPT) delivers fresh tool output.

From here you can:

- extend `sampleTasks` in `src/server.ts` with real data sources,
- enhance the component under `web/` (bundle via your preferred build tool),
- expose the service publicly via HTTPS (e.g. `ngrok http 3333`) when registering a connector in ChatGPT developer mode.

Happy hacking!
# OpenAI-AppSDK-Kanban
