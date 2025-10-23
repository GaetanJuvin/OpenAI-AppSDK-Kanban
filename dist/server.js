import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
const SERVER_INFO = {
    name: "kanban-sample-server",
    version: "1.0.0",
};
const ASSET_DIR = path.resolve(process.cwd(), "web", "dist");
const TEMPLATE_URI = "ui://widget/kanban-board@v4.html";
const CSS_URI = "ui://widget/kanban-board@v4.css";
const JS_URI = "ui://widget/kanban-board@v4.js";
const TOOL_KANBAN_BOARD = "kanban-board";
const javascriptBundle = readTextAsset("kanban.js");
const stylesheet = readTextAsset("kanban.css");
function readTextAsset(filename) {
    try {
        return readFileSync(path.join(ASSET_DIR, filename), "utf8");
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to load asset ${filename}: ${reason}`);
        return "";
    }
}
const initialTasks = [
    {
        id: "task-1",
        title: "Design empty states",
        assignee: "Ada",
        status: "todo",
    },
    {
        id: "task-2",
        title: "Wireframe admin panel",
        assignee: "Grace",
        status: "in-progress",
    },
    {
        id: "task-3",
        title: "QA onboarding flow",
        assignee: "Lin",
        status: "in-progress",
    },
    {
        id: "task-4",
        title: "Finalize pricing deck",
        assignee: "Alan",
        status: "done",
    },
    {
        id: "task-5",
        title: "Ship metrics dashboard",
        assignee: "Hedy",
        status: "todo",
    },
    {
        id: "task-6",
        title: "Review beta feedback",
        assignee: "Niels",
        status: "done",
    },
];
const taskStore = [...initialTasks];
function normalizeTaskInput(input) {
    const id = input.id?.trim() ?? `task-${Date.now()}`;
    return {
        id,
        title: input.title.trim(),
        assignee: input.assignee.trim(),
        status: input.status,
    };
}
function upsertTask(task) {
    const existingIndex = taskStore.findIndex((current) => current.id === task.id);
    if (existingIndex >= 0) {
        taskStore.splice(existingIndex, 1);
    }
    taskStore.unshift(task);
    return task;
}
function loadKanbanBoard() {
    const tasksById = Object.fromEntries(taskStore.map((task) => [task.id, task]));
    const groupedByStatus = {
        todo: [],
        "in-progress": [],
        done: [],
    };
    for (const task of taskStore) {
        groupedByStatus[task.status].push(task);
    }
    const columns = [
        { id: "todo", title: "To do", tasks: groupedByStatus["todo"] },
        {
            id: "in-progress",
            title: "In progress",
            tasks: groupedByStatus["in-progress"],
        },
        { id: "done", title: "Done", tasks: groupedByStatus["done"] },
    ];
    return {
        columns,
        tasksById,
        lastSyncedAt: new Date().toISOString(),
    };
}
function formatStructuredContent(board, statusFilter) {
    const filteredColumns = board.columns
        .filter((column) => !statusFilter || column.id === statusFilter)
        .map((column) => ({
        id: column.id,
        title: column.title,
        tasks: column.tasks.slice(0, 12),
    }));
    return {
        columns: filteredColumns,
        lastSyncedAt: board.lastSyncedAt,
    };
}
function buildWidgetState(board) {
    return {
        columns: board.columns,
        tasksById: board.tasksById,
        lastSyncedAt: board.lastSyncedAt,
    };
}
function buildToolResponse(params) {
    const structuredContent = formatStructuredContent(params.board, params.statusFilter);
    const widgetState = buildWidgetState(params.board);
    return {
        structuredContent,
        structured_content: structuredContent,
        content: [
            {
                type: "text",
                text: params.createdTask
                    ? `Added task "${params.createdTask.title}" to ${params.createdTask.status}. Here is the updated board.`
                    : "Here is the latest kanban snapshot.",
            },
        ],
        _meta: {
            tasksById: params.board.tasksById,
            lastSyncedAt: params.board.lastSyncedAt,
            columnsFull: params.board.columns,
            "openai/widgetState": widgetState,
            structuredContent,
            lastCreatedTask: params.createdTask,
        },
    };
}
function buildComponentHtml(cssUri, jsUri) {
    const styleTag = stylesheet ? `<style>${stylesheet}</style>` : "";
    const scriptTag = javascriptBundle
        ? `<script>${javascriptBundle}</script>`
        : "";
    return `\n    <div id="kanban-root"></div>\n    ${styleTag}\n    ${scriptTag}\n  `;
}
function registerResources(server) {
    const componentHtml = buildComponentHtml(CSS_URI, JS_URI);
    server.registerResource("kanban-widget", TEMPLATE_URI, {
        title: "Kanban board widget",
        description: "Component used by the kanban-board tool",
        _meta: {
            "openai/widgetPrefersBorder": true,
            "openai/widgetDomain": "https://chatgpt.com",
            "openai/widgetDescription": "Renders a kanban layout that groups tasks by status.",
            "openai/widgetCSP": {
                connect_domains: [],
                resource_domains: [],
            },
            "openai/widgetAccessible": true,
        },
    }, async () => ({
        contents: [
            {
                uri: TEMPLATE_URI,
                mimeType: "text/html+skybridge",
                text: componentHtml,
            },
        ],
    }));
    if (stylesheet) {
        server.registerResource("kanban-widget-css", CSS_URI, {}, async () => ({
            contents: [
                {
                    uri: CSS_URI,
                    mimeType: "text/css",
                    text: stylesheet,
                },
            ],
        }));
    }
    if (javascriptBundle) {
        server.registerResource("kanban-widget-js", JS_URI, {}, async () => ({
            contents: [
                {
                    uri: JS_URI,
                    mimeType: "text/javascript",
                    text: javascriptBundle,
                },
            ],
        }));
    }
}
function registerTools(server) {
    const taskInputSchema = z.object({
        id: z.string().min(1).optional(),
        title: z.string().min(1, "title is required"),
        assignee: z.string().min(1, "assignee is required"),
        status: z.enum(["todo", "in-progress", "done"]),
    });
    const toolInputSchema = z.object({
        statusFilter: z.enum(["todo", "in-progress", "done"]).optional(),
        newTask: taskInputSchema.optional(),
    });
    server.registerTool(TOOL_KANBAN_BOARD, {
        title: "Show kanban board",
        description: "Displays the sample kanban board grouped by status.",
        inputSchema: toolInputSchema.shape,
        _meta: {
            "openai/outputTemplate": TEMPLATE_URI,
            "openai/toolInvocation/invoking": "Loading board…",
            "openai/toolInvocation/invoked": "Board ready.",
            "openai/widgetAccessible": true,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
    }, async ({ statusFilter, newTask }) => {
        const createdTask = newTask
            ? upsertTask(normalizeTaskInput(newTask))
            : undefined;
        const board = loadKanbanBoard();
        const response = buildToolResponse({
            board,
            ...(statusFilter ? { statusFilter } : {}),
            ...(createdTask ? { createdTask } : {}),
        });
        return response;
    });
}
function createServer() {
    const server = new McpServer(SERVER_INFO, {
        capabilities: {
            tools: { listChanged: true },
            resources: { listChanged: true },
        },
    });
    registerResources(server);
    registerTools(server);
    return server;
}
async function main() {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.get("/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
    });
    app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        const server = createServer();
        res.on("close", () => {
            transport.close().catch(() => undefined);
            server.close().catch(() => undefined);
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Failed to handle MCP request:", message);
            if (!res.headersSent) {
                res.status(500).json({ error: "internal_server_error", message });
            }
        }
    });
    const port = Number(process.env.PORT ?? 3333);
    const host = process.env.HOST ?? "0.0.0.0";
    app.listen(port, host, () => {
        console.log(`MCP server listening on http://${host}:${port}/mcp`);
    });
}
void main();
//# sourceMappingURL=server.js.map