#!/usr/bin/env node
/**
 * Claude Swarm MCP Server — one per Claude Code instance.
 * Registers with broker, exposes tools, polls for messages.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

const PORT = parseInt(process.env["CLAUDE_SWARM_PORT"] ?? "7899", 10);
const BROKER_URL = `http://127.0.0.1:${PORT}`;
const POLL_INTERVAL = 1_000;
const HEARTBEAT_INTERVAL = 15_000;

let peerId: string | null = null;

/* ─── Broker Communication ─── */

async function brokerFetch<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${BROKER_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Broker ${endpoint} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function ensureBroker(): Promise<void> {
  try {
    const res = await fetch(`${BROKER_URL}/health`);
    if (res.ok) return;
  } catch {
    // Broker not running — start it
  }
  console.error("[claude-swarm] starting broker daemon...");
  const child = spawn("tsx", [path.join(import.meta.dirname, "broker.ts")], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  // Wait for broker to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${BROKER_URL}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
  }
  throw new Error("Failed to start broker");
}

/* ─── Context Gathering ─── */

function getGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function getTty(): string | null {
  try {
    return execSync("tty", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/* ─── MCP Server ─── */

const mcp = new McpServer({
  name: "claude-swarm",
  version: "1.0.0",
}, {
  instructions: `You are connected to Claude Swarm — a local multi-agent coordination system.

When you receive a <channel source="claude-swarm"> message, RESPOND IMMEDIATELY.
Pause your current work, reply using send_message, then resume.

Key concepts:
- ROOMS: Group agents working on the same task. Create or join a room to collaborate.
- TASKS: Delegate work to peers. Create tasks, assign them, track status.
- SCRATCHPAD: Shared key-value memory within a room. Store decisions, findings, context.
- BROADCAST: Send a message to all peers in your room.
- STATUS: Set your status (idle/busy/waiting/reviewing) so peers know your availability.`,
});

/* ─── Tools ─── */

mcp.tool("list_peers",
  "Discover other Claude Code instances. Use scope 'room' to see teammates, 'repo' for same project, 'machine' for all.",
  { scope: z.enum(["machine", "directory", "repo", "room"]).default("machine"), room_id: z.string().optional() },
  async ({ scope, room_id }) => {
    const { peers } = await brokerFetch<{ peers: unknown[] }>("/list-peers", {
      scope, exclude_id: peerId, room_id,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(peers, null, 2) }] };
  }
);

mcp.tool("send_message",
  "Send a direct message to a specific peer by their ID.",
  { to_id: z.string(), message: z.string() },
  async ({ to_id, message }) => {
    await brokerFetch("/send-message", { from_id: peerId, to_id, text: message });
    return { content: [{ type: "text" as const, text: `Message sent to ${to_id}` }] };
  }
);

mcp.tool("broadcast",
  "Send a message to ALL peers in your current room.",
  { message: z.string() },
  async ({ message }) => {
    const peer = await brokerFetch<{ id: string; room_id: string | null }>("/heartbeat", { id: peerId });
    // Get current peer info for room_id
    const { peers } = await brokerFetch<{ peers: Array<{ id: string; room_id: string | null }> }>("/list-peers", { scope: "machine", exclude_id: "___" });
    const me = peers.find((p) => p.id === peerId);
    if (!me?.room_id) return { content: [{ type: "text" as const, text: "Not in a room. Join or create one first." }] };
    await brokerFetch("/broadcast", { from_id: peerId, room_id: me.room_id, text: message });
    return { content: [{ type: "text" as const, text: `Broadcast sent to room ${me.room_id}` }] };
  }
);

mcp.tool("check_messages",
  "Check for new messages from other peers.",
  {},
  async () => {
    const { messages } = await brokerFetch<{ messages: unknown[] }>("/poll-messages", { id: peerId });
    if (messages.length === 0) return { content: [{ type: "text" as const, text: "No new messages." }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(messages, null, 2) }] };
  }
);

mcp.tool("message_history",
  "Search or browse message history. Optionally filter by room or search term.",
  { room_id: z.string().optional(), search: z.string().optional(), limit: z.number().default(20) },
  async ({ room_id, search, limit }) => {
    const result = await brokerFetch<{ messages: unknown[] }>("/message-history", { room_id, search, limit });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.messages, null, 2) }] };
  }
);

mcp.tool("set_summary",
  "Update your work summary so other peers know what you're doing.",
  { summary: z.string() },
  async ({ summary }) => {
    await brokerFetch("/set-summary", { id: peerId, summary });
    return { content: [{ type: "text" as const, text: "Summary updated." }] };
  }
);

mcp.tool("set_name",
  "Set a friendly name for this peer (e.g. 'frontend-agent', 'reviewer').",
  { name: z.string() },
  async ({ name }) => {
    await brokerFetch("/set-name", { id: peerId, name });
    return { content: [{ type: "text" as const, text: `Name set to "${name}"` }] };
  }
);

mcp.tool("set_status",
  "Set your availability status: idle, busy, waiting, or reviewing.",
  { status: z.enum(["idle", "busy", "waiting", "reviewing"]) },
  async ({ status }) => {
    await brokerFetch("/set-status", { id: peerId, status });
    return { content: [{ type: "text" as const, text: `Status set to ${status}` }] };
  }
);

/* ─── Room Tools ─── */

mcp.tool("create_room",
  "Create a new room for multi-agent collaboration. You auto-join it.",
  { name: z.string() },
  async ({ name }) => {
    const { room } = await brokerFetch<{ room: unknown }>("/create-room", { name, created_by: peerId });
    return { content: [{ type: "text" as const, text: `Room created:\n${JSON.stringify(room, null, 2)}` }] };
  }
);

mcp.tool("join_room",
  "Join an existing room by ID.",
  { room_id: z.string() },
  async ({ room_id }) => {
    await brokerFetch("/join-room", { peer_id: peerId, room_id });
    return { content: [{ type: "text" as const, text: `Joined room ${room_id}` }] };
  }
);

mcp.tool("leave_room",
  "Leave your current room.",
  {},
  async () => {
    await brokerFetch("/leave-room", { peer_id: peerId });
    return { content: [{ type: "text" as const, text: "Left room." }] };
  }
);

mcp.tool("list_rooms",
  "List all available rooms.",
  {},
  async () => {
    const result = await brokerFetch<{ rooms: unknown[] }>("/list-rooms", {});
    return { content: [{ type: "text" as const, text: JSON.stringify(result.rooms, null, 2) }] };
  }
);

/* ─── Task Tools ─── */

mcp.tool("create_task",
  "Create a task in a room and optionally assign it to a peer.",
  { room_id: z.string(), title: z.string(), description: z.string().default(""), assigned_to: z.string().optional() },
  async ({ room_id, title, description, assigned_to }) => {
    const result = await brokerFetch<{ task: unknown }>("/create-task", {
      room_id, title, description, created_by: peerId, assigned_to,
    });
    // Notify assigned peer
    if (assigned_to) {
      await brokerFetch("/send-message", {
        from_id: peerId, to_id: assigned_to,
        text: `[TASK ASSIGNED] ${title}\n${description}`,
      });
    }
    return { content: [{ type: "text" as const, text: `Task created:\n${JSON.stringify(result.task, null, 2)}` }] };
  }
);

mcp.tool("update_task",
  "Update a task's status (pending/in_progress/done/failed), result, or assignee.",
  { task_id: z.string(), status: z.enum(["pending", "in_progress", "done", "failed"]).optional(), result: z.string().optional(), assigned_to: z.string().optional() },
  async ({ task_id, status, result, assigned_to }) => {
    const res = await brokerFetch<{ task: unknown }>("/update-task", { task_id, status, result, assigned_to });
    return { content: [{ type: "text" as const, text: `Task updated:\n${JSON.stringify(res.task, null, 2)}` }] };
  }
);

mcp.tool("list_tasks",
  "List all tasks in a room.",
  { room_id: z.string() },
  async ({ room_id }) => {
    const result = await brokerFetch<{ tasks: unknown[] }>("/list-tasks", { room_id });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.tasks, null, 2) }] };
  }
);

/* ─── Scratchpad Tools ─── */

mcp.tool("scratchpad_get",
  "Read a value from the room's shared scratchpad.",
  { room_id: z.string(), key: z.string() },
  async ({ room_id, key }) => {
    const { entry } = await brokerFetch<{ entry: unknown }>("/scratchpad-get", { room_id, key });
    return { content: [{ type: "text" as const, text: entry ? JSON.stringify(entry, null, 2) : `Key "${key}" not found.` }] };
  }
);

mcp.tool("scratchpad_set",
  "Write a key-value pair to the room's shared scratchpad. Use for decisions, findings, shared context.",
  { room_id: z.string(), key: z.string(), value: z.string() },
  async ({ room_id, key, value }) => {
    await brokerFetch("/scratchpad-set", { room_id, key, value, updated_by: peerId });
    return { content: [{ type: "text" as const, text: `Scratchpad: "${key}" updated.` }] };
  }
);

mcp.tool("scratchpad_list",
  "List all entries in the room's shared scratchpad.",
  { room_id: z.string() },
  async ({ room_id }) => {
    const result = await brokerFetch<{ entries: unknown[] }>("/scratchpad-list", { room_id });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.entries, null, 2) }] };
  }
);

/* ─── Polling & Lifecycle ─── */

let pollTimer: ReturnType<typeof setInterval>;
let heartbeatTimer: ReturnType<typeof setInterval>;

async function startPolling(): Promise<void> {
  pollTimer = setInterval(async () => {
    try {
      const { messages } = await brokerFetch<{ messages: Array<{ from_id: string; from_name: string; text: string; sent_at: string; room_id: string | null }> }>("/poll-messages", { id: peerId });
      for (const msg of messages) {
        const source = msg.room_id ? `room:${msg.room_id}` : "direct";
        // Push as channel notification for immediate visibility
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            channel: "claude-swarm",
            data: {
              from: msg.from_name || msg.from_id,
              source,
              message: msg.text,
              sent_at: msg.sent_at,
            },
          },
        }) + "\n");
      }
    } catch { /* broker unreachable — skip */ }
  }, POLL_INTERVAL);

  heartbeatTimer = setInterval(async () => {
    try {
      await brokerFetch("/heartbeat", { id: peerId });
    } catch { /* skip */ }
  }, HEARTBEAT_INTERVAL);
}

async function cleanup(): Promise<void> {
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  if (peerId) {
    try {
      await brokerFetch("/unregister", { id: peerId });
    } catch { /* best effort */ }
  }
}

/* ─── Main ─── */

async function main(): Promise<void> {
  const cwd = process.cwd();
  const git_root = getGitRoot(cwd);
  const tty = getTty();

  await ensureBroker();

  const { id } = await brokerFetch<{ id: string }>("/register", {
    pid: process.pid,
    cwd,
    git_root,
    tty,
    name: path.basename(git_root ?? cwd),
  });
  peerId = id;
  console.error(`[claude-swarm] registered as ${id}`);

  await startPolling();

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
  process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
}

main().catch((err) => {
  console.error("[claude-swarm] fatal:", err);
  process.exit(1);
});
