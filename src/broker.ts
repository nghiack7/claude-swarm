#!/usr/bin/env node
/**
 * Claude Swarm Broker — singleton daemon on localhost.
 * Manages peers, rooms, tasks, scratchpad, and message routing.
 */
import http from "node:http";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type {
  RegisterRequest, RegisterResponse,
  HeartbeatRequest,
  ListPeersRequest, ListPeersResponse,
  SendMessageRequest,
  BroadcastRequest,
  PollMessagesRequest, PollMessagesResponse,
  CreateRoomRequest, CreateRoomResponse,
  JoinRoomRequest, LeaveRoomRequest,
  CreateTaskRequest, UpdateTaskRequest, ListTasksRequest,
  ScratchpadGetRequest, ScratchpadSetRequest, ScratchpadListRequest,
  MessageHistoryRequest,
  Peer, Message, Room,
  PeerId, PeerStatus,
} from "./shared/types.js";

const PORT = parseInt(process.env["CLAUDE_SWARM_PORT"] ?? "7899", 10);
const DB_PATH = process.env["CLAUDE_SWARM_DB"] ?? path.join(os.homedir(), ".claude-swarm.db");

/* ─── Database ─── */

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL,
    cwd TEXT NOT NULL,
    git_root TEXT,
    tty TEXT,
    name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idle',
    room_id TEXT,
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT,
    room_id TEXT,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assigned_to TEXT,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scratchpad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(room_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, delivered);
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, delivered);
  CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id);
  CREATE INDEX IF NOT EXISTS idx_peers_room ON peers(room_id);
`);

/* ─── Prepared Statements ─── */

const stmts = {
  registerPeer: db.prepare(`INSERT OR REPLACE INTO peers (id, pid, cwd, git_root, tty, name, summary, status, room_id, registered_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, '', 'idle', NULL, ?, ?)`),
  heartbeat: db.prepare(`UPDATE peers SET last_seen = ?, status = COALESCE(?, status) WHERE id = ?`),
  setSummary: db.prepare(`UPDATE peers SET summary = ? WHERE id = ?`),
  setName: db.prepare(`UPDATE peers SET name = ? WHERE id = ?`),
  setStatus: db.prepare(`UPDATE peers SET status = ? WHERE id = ?`),
  getPeer: db.prepare(`SELECT * FROM peers WHERE id = ?`),
  getAllPeers: db.prepare(`SELECT * FROM peers`),
  getPeersByRoom: db.prepare(`SELECT * FROM peers WHERE room_id = ?`),
  getPeersByCwd: db.prepare(`SELECT * FROM peers WHERE cwd = ?`),
  getPeersByGitRoot: db.prepare(`SELECT * FROM peers WHERE git_root = ?`),
  deletePeer: db.prepare(`DELETE FROM peers WHERE id = ?`),
  joinRoom: db.prepare(`UPDATE peers SET room_id = ? WHERE id = ?`),
  leaveRoom: db.prepare(`UPDATE peers SET room_id = NULL WHERE id = ?`),

  createRoom: db.prepare(`INSERT INTO rooms (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`),
  getRoom: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
  listRooms: db.prepare(`SELECT * FROM rooms ORDER BY created_at DESC`),

  sendMessage: db.prepare(`INSERT INTO messages (from_id, to_id, room_id, text, sent_at) VALUES (?, ?, ?, ?, ?)`),
  pollDirectMessages: db.prepare(`SELECT m.*, p.name as from_name, p.cwd as from_cwd FROM messages m LEFT JOIN peers p ON m.from_id = p.id WHERE m.to_id = ? AND m.delivered = 0 ORDER BY m.sent_at ASC`),
  pollRoomMessages: db.prepare(`SELECT m.*, p.name as from_name, p.cwd as from_cwd FROM messages m LEFT JOIN peers p ON m.from_id = p.id WHERE m.room_id = ? AND m.to_id IS NULL AND m.delivered = 0 AND m.from_id != ? ORDER BY m.sent_at ASC`),
  markDelivered: db.prepare(`UPDATE messages SET delivered = 1 WHERE id = ?`),
  messageHistory: db.prepare(`SELECT m.*, p.name as from_name, p.cwd as from_cwd FROM messages m LEFT JOIN peers p ON m.from_id = p.id ORDER BY m.sent_at DESC LIMIT ?`),
  messageHistoryByRoom: db.prepare(`SELECT m.*, p.name as from_name, p.cwd as from_cwd FROM messages m LEFT JOIN peers p ON m.from_id = p.id WHERE m.room_id = ? ORDER BY m.sent_at DESC LIMIT ?`),
  searchMessages: db.prepare(`SELECT m.*, p.name as from_name, p.cwd as from_cwd FROM messages m LEFT JOIN peers p ON m.from_id = p.id WHERE m.text LIKE ? ORDER BY m.sent_at DESC LIMIT ?`),

  createTask: db.prepare(`INSERT INTO tasks (id, room_id, title, description, assigned_to, created_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`),
  updateTask: db.prepare(`UPDATE tasks SET status = COALESCE(?, status), result = COALESCE(?, result), assigned_to = COALESCE(?, assigned_to), updated_at = ? WHERE id = ?`),
  getTask: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
  listTasks: db.prepare(`SELECT * FROM tasks WHERE room_id = ? ORDER BY created_at DESC`),

  scratchpadGet: db.prepare(`SELECT * FROM scratchpad WHERE room_id = ? AND key = ?`),
  scratchpadSet: db.prepare(`INSERT OR REPLACE INTO scratchpad (room_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`),
  scratchpadList: db.prepare(`SELECT * FROM scratchpad WHERE room_id = ? ORDER BY key`),
  scratchpadDelete: db.prepare(`DELETE FROM scratchpad WHERE room_id = ? AND key = ?`),
};

/* ─── Helpers ─── */

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanStalePeers(): void {
  const peers = stmts.getAllPeers.all() as Array<{ id: string; pid: number }>;
  for (const peer of peers) {
    if (!isProcessAlive(peer.pid)) {
      stmts.deletePeer.run(peer.id);
    }
  }
}

/* ─── Route Handlers ─── */

type Handler = (body: unknown) => unknown;

const routes: Record<string, Handler> = {
  "/register": (body) => {
    const { pid, cwd, git_root, tty, name } = body as RegisterRequest;
    // Prevent duplicate registration for same PID
    const existing = stmts.getAllPeers.all() as Array<{ id: string; pid: number }>;
    for (const p of existing) {
      if (p.pid === pid) stmts.deletePeer.run(p.id);
    }
    const id = genId("peer");
    const ts = now();
    stmts.registerPeer.run(id, pid, cwd, git_root ?? null, tty ?? null, name ?? path.basename(cwd), ts, ts);
    return { id } satisfies RegisterResponse;
  },

  "/heartbeat": (body) => {
    const { id, status } = body as HeartbeatRequest;
    stmts.heartbeat.run(now(), status ?? null, id);
    return { ok: true };
  },

  "/set-summary": (body) => {
    const { id, summary } = body as { id: PeerId; summary: string };
    stmts.setSummary.run(summary, id);
    return { ok: true };
  },

  "/set-name": (body) => {
    const { id, name } = body as { id: PeerId; name: string };
    stmts.setName.run(name, id);
    return { ok: true };
  },

  "/set-status": (body) => {
    const { id, status } = body as { id: PeerId; status: PeerStatus };
    stmts.setStatus.run(status, id);
    return { ok: true };
  },

  "/list-peers": (body) => {
    const { scope, exclude_id, room_id } = body as ListPeersRequest;
    cleanStalePeers();
    let peers;
    const excludePeer = stmts.getPeer.get(exclude_id ?? "") as { cwd: string; git_root: string | null } | undefined;

    switch (scope) {
      case "room":
        peers = stmts.getPeersByRoom.all(room_id ?? "");
        break;
      case "directory":
        peers = excludePeer ? stmts.getPeersByCwd.all(excludePeer.cwd) : stmts.getAllPeers.all();
        break;
      case "repo":
        peers = excludePeer?.git_root ? stmts.getPeersByGitRoot.all(excludePeer.git_root) : stmts.getAllPeers.all();
        break;
      default:
        peers = stmts.getAllPeers.all();
    }

    if (exclude_id) {
      peers = (peers as Array<{ id: string }>).filter((p) => p.id !== exclude_id);
    }
    return { peers: peers as Peer[] } satisfies ListPeersResponse;
  },

  "/unregister": (body) => {
    const { id } = body as { id: PeerId };
    stmts.deletePeer.run(id);
    return { ok: true };
  },

  /* ─── Messaging ─── */

  "/send-message": (body) => {
    const { from_id, to_id, room_id, text } = body as SendMessageRequest;
    stmts.sendMessage.run(from_id, to_id ?? null, room_id ?? null, text, now());
    return { ok: true };
  },

  "/broadcast": (body) => {
    const { from_id, room_id, text } = body as BroadcastRequest;
    stmts.sendMessage.run(from_id, null, room_id, text, now());
    return { ok: true };
  },

  "/poll-messages": (body) => {
    const { id } = body as PollMessagesRequest;
    // Get direct messages
    const direct = stmts.pollDirectMessages.all(id) as Array<Message & { from_name: string; from_cwd: string }>;
    // Get room broadcasts
    const peer = stmts.getPeer.get(id) as { room_id: string | null } | undefined;
    let roomMsgs: typeof direct = [];
    if (peer?.room_id) {
      roomMsgs = stmts.pollRoomMessages.all(peer.room_id, id) as typeof direct;
    }
    const all = [...direct, ...roomMsgs].sort((a, b) => a.sent_at < b.sent_at ? -1 : 1);
    // Mark all as delivered
    for (const msg of all) {
      stmts.markDelivered.run(msg.id);
    }
    return { messages: all } satisfies PollMessagesResponse;
  },

  "/message-history": (body) => {
    const { room_id, limit, search } = body as MessageHistoryRequest;
    const lim = Math.min(limit ?? 50, 200);
    if (search) {
      return { messages: stmts.searchMessages.all(`%${search}%`, lim) };
    }
    if (room_id) {
      return { messages: stmts.messageHistoryByRoom.all(room_id, lim) };
    }
    return { messages: stmts.messageHistory.all(lim) };
  },

  /* ─── Rooms ─── */

  "/create-room": (body) => {
    const { name, created_by } = body as CreateRoomRequest;
    const id = genId("room");
    stmts.createRoom.run(id, name, created_by, now());
    stmts.joinRoom.run(id, created_by);
    const room = stmts.getRoom.get(id) as Room;
    return { room } satisfies CreateRoomResponse;
  },

  "/join-room": (body) => {
    const { peer_id, room_id } = body as JoinRoomRequest;
    stmts.joinRoom.run(room_id, peer_id);
    return { ok: true };
  },

  "/leave-room": (body) => {
    const { peer_id } = body as LeaveRoomRequest;
    stmts.leaveRoom.run(peer_id);
    return { ok: true };
  },

  "/list-rooms": () => {
    const rooms = stmts.listRooms.all();
    return { rooms };
  },

  /* ─── Tasks ─── */

  "/create-task": (body) => {
    const { room_id, title, description, created_by, assigned_to } = body as CreateTaskRequest;
    const id = genId("task");
    const ts = now();
    stmts.createTask.run(id, room_id, title, description ?? "", assigned_to ?? null, created_by, ts, ts);
    const task = stmts.getTask.get(id);
    return { task };
  },

  "/update-task": (body) => {
    const { task_id, status, result, assigned_to } = body as UpdateTaskRequest;
    stmts.updateTask.run(status ?? null, result ?? null, assigned_to ?? null, now(), task_id);
    const task = stmts.getTask.get(task_id);
    return { task };
  },

  "/list-tasks": (body) => {
    const { room_id } = body as ListTasksRequest;
    const tasks = stmts.listTasks.all(room_id);
    return { tasks };
  },

  /* ─── Scratchpad (shared memory) ─── */

  "/scratchpad-get": (body) => {
    const { room_id, key } = body as ScratchpadGetRequest;
    const entry = stmts.scratchpadGet.get(room_id, key);
    return { entry: entry ?? null };
  },

  "/scratchpad-set": (body) => {
    const { room_id, key, value, updated_by } = body as ScratchpadSetRequest;
    stmts.scratchpadSet.run(room_id, key, value, updated_by, now());
    return { ok: true };
  },

  "/scratchpad-list": (body) => {
    const { room_id } = body as ScratchpadListRequest;
    const entries = stmts.scratchpadList.all(room_id);
    return { entries };
  },

  "/scratchpad-delete": (body) => {
    const { room_id, key } = body as { room_id: string; key: string };
    stmts.scratchpadDelete.run(room_id, key);
    return { ok: true };
  },
};

/* ─── HTTP Server ─── */

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    cleanStalePeers();
    const peers = stmts.getAllPeers.all() as Array<{ id: string }>;
    const rooms = stmts.listRooms.all() as Array<{ id: string }>;
    res.end(JSON.stringify({ status: "ok", peers: peers.length, rooms: rooms.length }));
    return;
  }

  if (req.method !== "POST" || !req.url) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const handler = routes[req.url];
  if (!handler) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const result = handler(body);
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
});

// Cleanup stale peers every 30s
const cleanupInterval = setInterval(cleanStalePeers, 30_000);

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[claude-swarm] broker listening on 127.0.0.1:${PORT}`);
  console.error(`[claude-swarm] database: ${DB_PATH}`);
});

process.on("SIGINT", () => {
  clearInterval(cleanupInterval);
  db.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(cleanupInterval);
  db.close();
  process.exit(0);
});
