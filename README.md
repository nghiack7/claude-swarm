# Claude Swarm

> Local-first multi-agent coordination for Claude Code. Zero cloud, zero API keys.

**Claude Swarm** lets multiple Claude Code instances on your machine discover each other, form rooms, delegate tasks, share memory, and communicate in real-time — all through a lightweight local broker.

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Claude A │     │ Claude B │     │ Claude C │
│ frontend │     │ backend  │     │ reviewer │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │   MCP (stdio)  │                │
     └────────┬───────┘────────────────┘
              │
        ┌─────▼──────┐
        │   Broker    │  localhost:7899
        │   SQLite    │  ~/.claude-swarm.db
        └────────────┘
```

## Why?

You're running 3 Claude Code sessions — one on frontend, one on backend, one reviewing. They can't talk to each other. You copy-paste context between terminals. **Claude Swarm fixes this.**

## Features

| Feature | Description |
|---------|-------------|
| **Peer Discovery** | Auto-discover Claude instances by machine, directory, repo, or room |
| **Rooms** | Group agents working on the same task. Broadcast, share context |
| **Tasks** | Delegate work to peers. Create → assign → track → complete |
| **Scratchpad** | Shared key-value memory per room. Store decisions and findings |
| **Broadcast** | One message to all room members |
| **Status** | Set idle/busy/waiting/reviewing so peers know your availability |
| **Message History** | Search past messages across rooms |
| **Beautiful CLI** | Color-coded dashboard with peer status, rooms, tasks |
| **Zero Config** | No API keys, no cloud, no accounts. Just install and go |
| **Node.js + Bun** | Works with both runtimes |

## Install

```bash
# Clone
git clone https://github.com/personal/claude-swarm.git
cd claude-swarm
npm install

# Register as MCP server (one-time)
claude mcp add --scope user --transport stdio claude-swarm -- npx tsx $(pwd)/src/server.ts
```

## Quick Start

### 1. Open multiple Claude Code sessions

```bash
# Terminal 1
cd my-project && claude

# Terminal 2
cd my-project && claude

# Terminal 3 (reviewer)
cd my-project && claude
```

### 2. Each Claude instance auto-discovers peers

```
> list_peers scope="repo"

[
  { "id": "peer_abc", "name": "my-project", "status": "idle" },
  { "id": "peer_def", "name": "my-project", "status": "busy" }
]
```

### 3. Create a room and collaborate

```
> create_room name="sprint-1"
> set_name name="frontend-agent"
> set_status status="busy"

> create_task room_id="room_xyz" title="Fix auth bug" assigned_to="peer_def"
> broadcast message="Auth module is broken, I'm investigating the JWT hook"
> scratchpad_set room_id="room_xyz" key="root-cause" value="JWT hook missing SECURITY DEFINER"
```

### 4. Monitor from CLI

```bash
npx tsx src/cli.ts status
```

```
 ⚡ CLAUDE SWARM
────────────────────────────────────────────────────────────
  ● Broker: running on port 7899
  Peers: 3  |  Rooms: 1
────────────────────────────────────────────────────────────

  frontend-agent  BUSY  [room_xyz123]
  ID: peer_abc123456
  CWD: /Users/dev/my-project
  Investigating auth module JWT hook issue
  Last seen: 2s ago

  backend-agent  IDLE  [room_xyz123]
  ID: peer_def789012
  CWD: /Users/dev/my-project
  Waiting for task assignment
  Last seen: 5s ago

  reviewer  REVIEW  [room_xyz123]
  ID: peer_ghi345678
  CWD: /Users/dev/my-project
  Reviewing PR #42
  Last seen: 1s ago
```

## MCP Tools (22 tools)

### Core
| Tool | Description |
|------|-------------|
| `list_peers` | Discover peers (scope: machine/directory/repo/room) |
| `send_message` | Direct message to a peer |
| `broadcast` | Message all peers in your room |
| `check_messages` | Poll for new messages |
| `message_history` | Search/browse past messages |
| `set_summary` | Update your work description |
| `set_name` | Set a friendly name |
| `set_status` | Set availability (idle/busy/waiting/reviewing) |

### Rooms
| Tool | Description |
|------|-------------|
| `create_room` | Create a collaboration room (auto-join) |
| `join_room` | Join an existing room |
| `leave_room` | Leave your current room |
| `list_rooms` | List all rooms |

### Tasks
| Tool | Description |
|------|-------------|
| `create_task` | Create a task in a room (optionally assign) |
| `update_task` | Update status/result/assignee |
| `list_tasks` | List tasks in a room |

### Scratchpad (Shared Memory)
| Tool | Description |
|------|-------------|
| `scratchpad_get` | Read a value |
| `scratchpad_set` | Write a key-value pair |
| `scratchpad_list` | List all entries |

## CLI Commands

```bash
npx tsx src/cli.ts status          # Dashboard overview
npx tsx src/cli.ts peers           # List peers
npx tsx src/cli.ts rooms           # List rooms
npx tsx src/cli.ts send <id> <msg> # Send direct message
npx tsx src/cli.ts broadcast <room> <msg>  # Broadcast
npx tsx src/cli.ts history --room <id> --search <term>
npx tsx src/cli.ts tasks <room_id> # List tasks
npx tsx src/cli.ts scratchpad <room_id>    # Shared memory
npx tsx src/cli.ts kill            # Kill broker
npx tsx src/cli.ts help            # Help
```

## Architecture

```
Claude Code ←── stdio ──→ MCP Server (1 per session)
                              │
                              │ HTTP (localhost:7899)
                              ▼
                         Broker Daemon
                              │
                              ▼
                     SQLite (~/.claude-swarm.db)
                     ├── peers (discovery + status)
                     ├── rooms (collaboration groups)
                     ├── messages (queue + history)
                     ├── tasks (delegation + tracking)
                     └── scratchpad (shared memory)
```

**Key design decisions:**
- **Local-only**: All traffic on 127.0.0.1. No network exposure.
- **Zero dependencies on external APIs**: No OpenAI, no cloud. Pure local.
- **SQLite + WAL**: Fast, concurrent, crash-safe.
- **Process verification**: Broker checks if peers are alive via `kill(pid, 0)`.
- **Auto-cleanup**: Stale peers removed every 30s.
- **1s polling + channel push**: Messages delivered within 1 second.

## vs claude-peers-mcp (original)

| Feature | claude-peers-mcp | Claude Swarm |
|---------|-----------------|--------------|
| Peer discovery | ✓ | ✓ |
| Direct messages | ✓ | ✓ |
| Rooms | ✕ | ✓ |
| Broadcast | ✕ | ✓ |
| Task delegation | ✕ | ✓ |
| Shared scratchpad | ✕ | ✓ |
| Peer status | ✕ | ✓ (idle/busy/waiting/reviewing) |
| Message history | ✕ | ✓ (with search) |
| Peer naming | ✕ | ✓ |
| CLI dashboard | Basic | Color-coded with status badges |
| External API dependency | OpenAI (for summaries) | None |
| Runtime | Bun only | Node.js + Bun |
| Tools count | 4 | 22 |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_SWARM_PORT` | `7899` | Broker port |
| `CLAUDE_SWARM_DB` | `~/.claude-swarm.db` | SQLite path |

## License

MIT — Fork of [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) by louislva.
