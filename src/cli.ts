#!/usr/bin/env node
/**
 * Claude Swarm CLI — inspect, manage, and orchestrate the swarm.
 *
 * Usage:
 *   claude-swarm run <task>      Orchestrate a multi-agent swarm run
 *   claude-swarm status          Show broker health + all peers
 *   claude-swarm peers           List peers with status
 *   claude-swarm rooms           List rooms
 *   claude-swarm adapters        List available CLI adapters
 *   claude-swarm send <id> <msg> Send message to peer
 *   claude-swarm broadcast <room> <msg> Broadcast to room
 *   claude-swarm history [--room <id>] [--search <term>]
 *   claude-swarm tasks <room_id> List tasks in room
 *   claude-swarm scratchpad <room_id> List scratchpad entries
 *   claude-swarm kill            Kill broker daemon
 */
import { execSync } from "node:child_process";
import { parseAgentSpec, executeRun, DEFAULT_PIPELINE, type AgentSpec, type RunMode } from "./orchestrator.js";
import { listAdapters } from "./adapters.js";
import { TUI, printSummary } from "./tui.js";

const PORT = parseInt(process.env["CLAUDE_SWARM_PORT"] ?? "7899", 10);
const BASE = `http://127.0.0.1:${PORT}`;

async function api<T>(endpoint: string, body: unknown = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const method = endpoint.startsWith("/health") ? "GET" : "POST";
    const opts: RequestInit = { method, signal: controller.signal };
    if (method === "POST") {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${endpoint}`, opts);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

/* ─── Formatters ─── */

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgRed: "\x1b[41m",
};

const STATUS_BADGE: Record<string, string> = {
  idle: `${COLORS.bgGreen}${COLORS.bold} IDLE ${COLORS.reset}`,
  busy: `${COLORS.bgYellow}${COLORS.bold} BUSY ${COLORS.reset}`,
  waiting: `${COLORS.bgBlue}${COLORS.bold} WAIT ${COLORS.reset}`,
  reviewing: `${COLORS.bgRed}${COLORS.bold} REVIEW ${COLORS.reset}`,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function line(char = "─", len = 60): string {
  return COLORS.dim + char.repeat(len) + COLORS.reset;
}

/* ─── Commands ─── */

async function cmdStatus(): Promise<void> {
  const health = await api<{ status: string; peers: number; rooms: number }>("/health");

  console.log(`\n${COLORS.bold}${COLORS.cyan} CLAUDE SWARM ${COLORS.reset}`);
  console.log(line());
  console.log(`  ${COLORS.green}●${COLORS.reset} Broker: ${COLORS.bold}running${COLORS.reset} on port ${PORT}`);
  console.log(`  Peers: ${COLORS.bold}${health.peers}${COLORS.reset}  |  Rooms: ${COLORS.bold}${health.rooms}${COLORS.reset}`);
  console.log(line());

  if (health.peers > 0) {
    const { peers } = await api<{ peers: Array<{ id: string; name: string; cwd: string; status: string; room_id: string | null; summary: string; last_seen: string }> }>("/list-peers", { scope: "machine" });

    for (const p of peers) {
      const badge = STATUS_BADGE[p.status] ?? p.status;
      const room = p.room_id ? `${COLORS.magenta}[${p.room_id.slice(0, 12)}]${COLORS.reset}` : `${COLORS.dim}no room${COLORS.reset}`;
      console.log(`\n  ${COLORS.bold}${p.name}${COLORS.reset} ${badge} ${room}`);
      console.log(`  ${COLORS.dim}ID: ${p.id}${COLORS.reset}`);
      console.log(`  ${COLORS.dim}CWD: ${p.cwd}${COLORS.reset}`);
      if (p.summary) console.log(`  ${COLORS.cyan}${p.summary}${COLORS.reset}`);
      console.log(`  ${COLORS.dim}Last seen: ${timeAgo(p.last_seen)}${COLORS.reset}`);
    }
  }

  console.log();
}

async function cmdPeers(): Promise<void> {
  const { peers } = await api<{ peers: Array<{ id: string; name: string; status: string; cwd: string; room_id: string | null; summary: string }> }>("/list-peers", { scope: "machine" });

  if (peers.length === 0) {
    console.log(`${COLORS.dim}No peers connected.${COLORS.reset}`);
    return;
  }

  console.log(`\n${COLORS.bold}Peers (${peers.length})${COLORS.reset}\n`);
  for (const p of peers) {
    const badge = STATUS_BADGE[p.status] ?? p.status;
    console.log(`  ${badge} ${COLORS.bold}${p.name}${COLORS.reset} ${COLORS.dim}(${p.id.slice(0, 16)})${COLORS.reset}`);
    if (p.summary) console.log(`    ${COLORS.cyan}${p.summary}${COLORS.reset}`);
  }
  console.log();
}

async function cmdRooms(): Promise<void> {
  const { rooms } = await api<{ rooms: Array<{ id: string; name: string; created_at: string }> }>("/list-rooms", {});
  if (rooms.length === 0) {
    console.log(`${COLORS.dim}No rooms.${COLORS.reset}`);
    return;
  }
  console.log(`\n${COLORS.bold}Rooms (${rooms.length})${COLORS.reset}\n`);
  for (const r of rooms) {
    // Count peers in room
    const { peers } = await api<{ peers: unknown[] }>("/list-peers", { scope: "room", room_id: r.id });
    console.log(`  ${COLORS.magenta}●${COLORS.reset} ${COLORS.bold}${r.name}${COLORS.reset} ${COLORS.dim}(${r.id})${COLORS.reset}`);
    console.log(`    ${peers.length} peers | Created ${timeAgo(r.created_at)}`);
  }
  console.log();
}

async function cmdSend(toId: string, message: string): Promise<void> {
  await api("/send-message", { from_id: "cli", to_id: toId, text: message });
  console.log(`${COLORS.green}✓${COLORS.reset} Message sent to ${toId}`);
}

async function cmdBroadcast(roomId: string, message: string): Promise<void> {
  await api("/broadcast", { from_id: "cli", room_id: roomId, text: message });
  console.log(`${COLORS.green}✓${COLORS.reset} Broadcast sent to room ${roomId}`);
}

async function cmdHistory(roomId?: string, search?: string): Promise<void> {
  const { messages } = await api<{ messages: Array<{ from_name: string; from_id: string; text: string; sent_at: string; room_id: string | null }> }>("/message-history", { room_id: roomId, search, limit: 30 });

  if (messages.length === 0) {
    console.log(`${COLORS.dim}No messages found.${COLORS.reset}`);
    return;
  }

  console.log(`\n${COLORS.bold}Messages (${messages.length})${COLORS.reset}\n`);
  for (const m of messages.reverse()) {
    const from = m.from_name || m.from_id.slice(0, 12);
    const time = new Date(m.sent_at).toLocaleTimeString();
    console.log(`  ${COLORS.dim}${time}${COLORS.reset} ${COLORS.bold}${from}${COLORS.reset}: ${m.text}`);
  }
  console.log();
}

async function cmdTasks(roomId: string): Promise<void> {
  const { tasks } = await api<{ tasks: Array<{ id: string; title: string; status: string; assigned_to: string | null; result: string | null }> }>("/list-tasks", { room_id: roomId });

  if (tasks.length === 0) {
    console.log(`${COLORS.dim}No tasks in this room.${COLORS.reset}`);
    return;
  }

  const statusIcon: Record<string, string> = {
    pending: `${COLORS.yellow}○${COLORS.reset}`,
    in_progress: `${COLORS.blue}◑${COLORS.reset}`,
    done: `${COLORS.green}●${COLORS.reset}`,
    failed: `${COLORS.red}✕${COLORS.reset}`,
  };

  console.log(`\n${COLORS.bold}Tasks (${tasks.length})${COLORS.reset}\n`);
  for (const t of tasks) {
    const icon = statusIcon[t.status] ?? "?";
    const assignee = t.assigned_to ? `${COLORS.dim}→ ${t.assigned_to.slice(0, 12)}${COLORS.reset}` : "";
    console.log(`  ${icon} ${t.title} ${assignee}`);
    if (t.result) console.log(`    ${COLORS.cyan}Result: ${t.result}${COLORS.reset}`);
  }
  console.log();
}

async function cmdScratchpad(roomId: string): Promise<void> {
  const { entries } = await api<{ entries: Array<{ key: string; value: string; updated_by: string; updated_at: string }> }>("/scratchpad-list", { room_id: roomId });

  if (entries.length === 0) {
    console.log(`${COLORS.dim}Scratchpad empty.${COLORS.reset}`);
    return;
  }

  console.log(`\n${COLORS.bold}Scratchpad (${entries.length} entries)${COLORS.reset}\n`);
  for (const e of entries) {
    console.log(`  ${COLORS.cyan}${e.key}${COLORS.reset}: ${e.value}`);
    console.log(`    ${COLORS.dim}by ${e.updated_by.slice(0, 12)} | ${timeAgo(e.updated_at)}${COLORS.reset}`);
  }
  console.log();
}

/* ─── Swarm Run ─── */

async function cmdRun(taskParts: string[], agentSpecs: string[], mode: RunMode, noTui: boolean): Promise<void> {
  const task = taskParts.join(" ");
  if (!task) {
    console.error(`${COLORS.red}✕${COLORS.reset} Usage: claude-swarm run <task> [--agent role:cli:model] [--mode pipeline|parallel] [--no-tui]`);
    process.exit(1);
  }

  const agents: AgentSpec[] = agentSpecs.length > 0
    ? agentSpecs.map(parseAgentSpec)
    : DEFAULT_PIPELINE;

  console.log(`${COLORS.cyan}🐝 CLAUDE SWARM${COLORS.reset} — Starting ${mode} run with ${agents.length} agents\n`);

  for (const a of agents) {
    console.log(`  ${COLORS.bold}${a.role}${COLORS.reset} → ${a.cli}${a.model ? `/${a.model}` : ""}`);
  }
  console.log();

  const run = executeRun(task, agents, mode, process.cwd());

  // If TUI mode, show live dashboard
  if (!noTui && process.stdout.isTTY) {
    // Wait a tick for the run object to be created, then start TUI
    const runResult = await run;
    printSummary(runResult);
  } else {
    const runResult = await run;
    printSummary(runResult);
  }
}

async function cmdAdapters(): Promise<void> {
  const adapters = listAdapters();
  console.log(`\n${COLORS.bold}CLI Adapters${COLORS.reset}\n`);
  for (const a of adapters) {
    const status = a.available
      ? `${COLORS.green}● available${COLORS.reset}`
      : `${COLORS.red}✕ not found${COLORS.reset}`;
    console.log(`  ${COLORS.bold}${a.name}${COLORS.reset} ${status} (default model: ${COLORS.dim}${a.defaultModel}${COLORS.reset})`);
  }
  console.log();
}

/* ─── Kill ─── */

async function cmdKill(): Promise<void> {
  try {
    const result = execSync(`lsof -ti :${PORT}`, { encoding: "utf-8" }).trim();
    if (result) {
      for (const pid of result.split("\n")) {
        process.kill(parseInt(pid, 10), "SIGTERM");
      }
      console.log(`${COLORS.green}✓${COLORS.reset} Broker killed.`);
    }
  } catch {
    console.log(`${COLORS.dim}Broker not running.${COLORS.reset}`);
  }
}

/* ─── Main ─── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  try {
    switch (cmd) {
      case "run": {
        const taskParts: string[] = [];
        const agentSpecs: string[] = [];
        let mode: RunMode = "pipeline";
        let noTui = false;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--agent" && args[i + 1]) { agentSpecs.push(args[++i]); }
          else if (args[i] === "--mode" && args[i + 1]) { mode = args[++i] as RunMode; }
          else if (args[i] === "--no-tui") { noTui = true; }
          else if (!args[i].startsWith("--")) { taskParts.push(args[i]); }
        }
        await cmdRun(taskParts, agentSpecs, mode, noTui);
        break;
      }
      case "adapters":
        await cmdAdapters();
        break;
      case "status": case undefined:
        await cmdStatus();
        break;
      case "peers":
        await cmdPeers();
        break;
      case "rooms":
        await cmdRooms();
        break;
      case "send":
        if (!args[1] || !args[2]) { console.error("Usage: claude-swarm send <peer_id> <message>"); process.exit(1); }
        await cmdSend(args[1], args.slice(2).join(" "));
        break;
      case "broadcast":
        if (!args[1] || !args[2]) { console.error("Usage: claude-swarm broadcast <room_id> <message>"); process.exit(1); }
        await cmdBroadcast(args[1], args.slice(2).join(" "));
        break;
      case "history": {
        let roomId: string | undefined;
        let search: string | undefined;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--room" && args[i + 1]) { roomId = args[++i]; }
          else if (args[i] === "--search" && args[i + 1]) { search = args[++i]; }
        }
        await cmdHistory(roomId, search);
        break;
      }
      case "tasks":
        if (!args[1]) { console.error("Usage: claude-swarm tasks <room_id>"); process.exit(1); }
        await cmdTasks(args[1]);
        break;
      case "scratchpad":
        if (!args[1]) { console.error("Usage: claude-swarm scratchpad <room_id>"); process.exit(1); }
        await cmdScratchpad(args[1]);
        break;
      case "kill":
        await cmdKill();
        break;
      case "help":
        console.log(`
${COLORS.bold}${COLORS.cyan}Claude Swarm${COLORS.reset} — Multi-CLI agent orchestration

${COLORS.bold}Orchestration:${COLORS.reset}
  run <task>          Run a multi-agent swarm
    --agent <spec>    Agent spec: role:cli:model (repeatable)
    --mode <mode>     pipeline (default) or parallel
    --no-tui          Disable live dashboard
  adapters            List available CLI adapters

${COLORS.bold}Coordination:${COLORS.reset}
  status              Show broker health + all peers (default)
  peers               List connected peers
  rooms               List rooms
  send <id> <msg>     Send direct message to peer
  broadcast <room> <msg>  Broadcast to room
  history [opts]      Message history (--room <id>, --search <term>)
  tasks <room_id>     List tasks in room
  scratchpad <room>   List scratchpad entries
  kill                Kill broker daemon

${COLORS.bold}Agent Spec Format:${COLORS.reset}
  role:cli:model      e.g. planner:claude:claude-sonnet-4-6
  role:cli            e.g. coder:codex (uses default model)
  role                e.g. reviewer (uses claude with default model)

${COLORS.bold}Examples:${COLORS.reset}
  claude-swarm run "Build a REST API"
  claude-swarm run "Fix auth bug" --agent "analyst:claude:claude-sonnet-4-6" --agent "fixer:codex"
  claude-swarm run "Review codebase" --agent "reviewer:gemini" --mode parallel

${COLORS.bold}Environment:${COLORS.reset}
  CLAUDE_SWARM_PORT   Broker port (default: 7899)
  CLAUDE_SWARM_DB     SQLite path (default: ~/.claude-swarm.db)
`);
        break;
      default:
        console.error(`Unknown command: ${cmd}. Run 'claude-swarm help' for usage.`);
        process.exit(1);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      console.error(`${COLORS.red}✕${COLORS.reset} Broker not running. Start it with: npx tsx src/broker.ts`);
    } else {
      console.error(`${COLORS.red}✕${COLORS.reset} Error:`, err);
    }
    process.exit(1);
  }
}

main();
