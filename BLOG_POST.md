# Claude Swarm: Multi-CLI Agent Orchestration for Developers

> Stop copy-pasting between Claude, Codex, and Gemini. Orchestrate them from one command.

---

## The Problem: AI Tools in Silos

It's 2026. You have three powerful AI coding assistants in your toolkit:
- **Claude** (best at reasoning and architecture)
- **Codex** (best at implementation)
- **Gemini** (fast and independent perspective)

But they don't talk to each other.

Here's your current workflow:

1. Open Claude Code. Run a prompt. Get a plan.
2. Copy the output. Switch to Codex CLI. Paste it. Ask for implementation.
3. Copy the code. Switch to Gemini CLI. Paste it. Ask for a review.
4. Copy-paste the review back to Claude. Iterate.

Three terminals. Three CLIs. One human doing manual coordination. It's inefficient. It's error-prone. And it breaks flow.

**This is the cost of silos.**

---

## The Solution: Claude Swarm

Claude Swarm is an **orchestration layer above the agents**. It lets you:

1. **Define a task** — "Build a REST API with Express and TypeScript"
2. **Specify agents** — Which CLI (Claude, Codex, Gemini), which role (planner, implementer, reviewer), which model
3. **Pick a mode** — Pipeline (sequential, context-aware) or Parallel (simultaneous, independent)
4. **Run one command** — Everything else is automated

```bash
npx claude-swarm run "Build a REST API with Express and TypeScript"
```

No copy-paste. No switching. No manual coordination. Just **orchestration**.

---

## How It Works

### Two Execution Modes

#### 1. Pipeline Mode (Sequential, Context-Aware)

Agents run in sequence. Each agent receives all previous outputs as context.

```
Planner ──→ Implementer ──→ Reviewer
  ↓           ↓              ↓
Design    Code        Final Review
```

**Perfect for:**
- Feature building (architecture → implementation → review)
- Bug fixes (diagnosis → fix → verification)
- Architecture decisions (design → implementation → performance check)

**Example:**
```bash
npx claude-swarm run "Build a payment flow with Stripe" \
  --agent "architect:claude:claude-sonnet-4-6" \
  --agent "implementer:codex:o4-mini" \
  --agent "reviewer:gemini:gemini-2.5-pro"
```

The architect designs the payment state machine. The implementer sees the design and writes the code. The reviewer sees both the design and code, and checks for security/PCI compliance.

#### 2. Parallel Mode (Simultaneous, Independent)

All agents run at the same time with the same task. No shared context.

```
┌─ Agent 1
├─ Agent 2 (all run simultaneously)
└─ Agent 3
```

**Perfect for:**
- Multi-perspective code review (security, performance, quality)
- Independent analysis (each reviewer brings their own lens)
- Parallelizable work (no dependencies between agents)

**Example:**
```bash
npx claude-swarm run "Review this codebase for issues" \
  --agent "security:claude" \
  --agent "performance:codex" \
  --agent "quality:gemini" \
  --mode parallel
```

All three run simultaneously. No waiting. Get three independent verdicts in one go.

---

### Live Dashboard

As agents run, you see real-time progress in a beautiful TUI:

```
┌─────────────────────────────────────────────────────────────┐
│  🐝 CLAUDE SWARM — "Build a REST API"                       │
│  Mode: pipeline | Agents: 1/3 done | Elapsed: 45s           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ██████████████ DONE  planner (claude/sonnet-4-6)           │
│    Completed in 32s | 2.1KB output                           │
│                                                              │
│  ██████░░░░░░░░ RUN   implementer (codex/o4-mini)           │
│    18s elapsed | 1.4KB output | 23 lines                     │
│    > Writing Express routes for /todos endpoints...          │
│                                                              │
│  ░░░░░░░░░░░░░░ WAIT  reviewer (gemini/pro)                │
│    Waiting...                                                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Latest output (implementer):                                │
│  > Created src/routes/todos.ts with CRUD endpoints           │
│  > Added input validation with zod schemas                   │
└─────────────────────────────────────────────────────────────┘
```

No switching terminals. Everything in one unified view.

---

### Architecture Overview

Claude Swarm has two layers:

#### Layer 1: Orchestrator (The New Part)

Spawns and manages CLI processes:
- Parses agent specs (`role:cli:model`)
- Constructs role-specific prompts
- Manages agent lifecycles
- Collects and filters output
- Handles pipeline vs. parallel execution

Each agent runs as a real subprocess with full tool access. They can edit files, run tests, and interact with your codebase.

#### Layer 2: Broker (MCP Server)

Runs on `localhost:7899` for peer coordination between Claude Code sessions:
- **Peer discovery** — Find other Claude instances
- **Rooms** — Collaboration groups
- **Messages** — Direct and broadcast messaging
- **Tasks** — Delegation and tracking
- **Scratchpad** — Shared memory
- **22 MCP Tools** — Full coordination API

You can use Claude Swarm as an MCP server to enable real-time collaboration without the orchestrator. They work independently or together.

---

## Agent Spec Format

Agents are specified as: `role:cli:model`

- `role` — Agent's persona in the prompt (planner, implementer, reviewer, etc.)
- `cli` — Which CLI to use (claude, codex, gemini)
- `model` — Specific model version (optional; uses default if omitted)

**Examples:**

```
planner:claude:claude-sonnet-4-6       Full spec
coder:codex                              Default model for Codex
reviewer                                 Default CLI (claude) and model
security:gemini:gemini-2.5-pro          Custom Gemini model
architect:claude                         Claude with default model
```

---

## Default Pipeline

If you don't specify agents, Claude Swarm uses a sensible default:

| Step | Role | Model | Purpose |
|------|------|-------|---------|
| 1 | **Planner** | Claude Sonnet | Architecture and plan |
| 2 | **Implementer** | Claude Sonnet | Write the code |
| 3 | **Reviewer** | Claude Sonnet | Review for bugs, edge cases, improvements |

Override this however you like:

```bash
# Use the default
npx claude-swarm run "Build a feature"

# Mix models and CLIs
npx claude-swarm run "Build a feature" \
  --agent "planner:claude" \
  --agent "coder:codex" \
  --agent "reviewer:gemini"

# Use specific model versions
npx claude-swarm run "Build a feature" \
  --agent "planner:claude:claude-opus-4-6" \
  --agent "coder:codex:o4" \
  --agent "reviewer:claude:claude-haiku-4-5"
```

---

## Key Design Decisions

### 1. **Multi-CLI, Not Vendor Lock-in**

Claude Swarm doesn't lock you to one provider. It supports Claude, Codex, Gemini, and any future CLI that accepts a prompt and returns output. Add a new CLI in ~20 lines:

```typescript
const myAdapter: CLIAdapter = {
  name: "mycli",
  defaultModel: "my-model",
  available: () => commandExists("mycli"),
  spawn: ({ prompt, model, cwd }) => {
    return spawn("mycli", ["run", prompt, "--model", model], {
      cwd, stdio: ["ignore", "pipe", "pipe"],
    });
  },
};
```

This is **extensibility by design**. You're not betting on Claude Swarm's roadmap; you're building on top of it.

### 2. **Local-Only, Zero Cloud Dependency**

All coordination happens on `127.0.0.1:7899`. No cloud. No subscriptions. No API keys for the swarm layer. Each agent runs as a subprocess in your terminal. Full tool access. Full filesystem access.

Privacy and autonomy by default.

### 3. **Zero Configuration**

No YAML files. No config dance. Agent specs are CLI flags. Defaults work out of the box:

```bash
# This just works
npx claude-swarm run "Your task"
```

### 4. **Protocol-Agnostic Broker**

The broker uses HTTP + SQLite. Any process can talk to it. Any future tool can integrate. Not locked to MCP, though MCP is the primary integration.

### 5. **Output Noise Filtering**

Different CLIs emit different noise (metadata, warnings, token counts). Claude Swarm intelligently filters it:

```typescript
const NOISE_PATTERNS = [
  /^[\d-]+T[\d:.]+Z (ERROR|WARN) codex_core/,   // codex warnings
  /^deprecated:/,                                // deprecation notices
  /^tokens used$/,                               // token counts
  // ... and more
];
```

Only clean output makes it into the final result.

---

## Installation & Quick Start

### Prerequisites

- Node.js 20+
- One or more of: Claude Code, Codex CLI, Gemini CLI (installed and in your PATH)

### Install

```bash
git clone https://github.com/nghiack7/claude-swarm.git
cd claude-swarm
npm install
```

### Run Your First Swarm

```bash
npx tsx src/cli.ts run "Build a todo REST API with Express and TypeScript"
```

The default pipeline starts immediately. Watch the TUI dashboard. When it's done, you get a summary of each agent's output and timing.

### Check Available Adapters

```bash
npx tsx src/cli.ts adapters
```

Output:
```
CLI Adapters

  claude ● available (default model: claude-sonnet-4-6)
  codex  ● available (default model: o4-mini)
  gemini ✕ not found (default model: gemini-2.5-pro)
```

Green dot = installed. Red X = install or put in PATH.

### Inspect Peers and Rooms (MCP Mode)

If you have Claude Code sessions registered as MCP peers:

```bash
npx tsx src/cli.ts peers
npx tsx src/cli.ts rooms
npx tsx src/cli.ts history --search "keyword"
```

---

## CLI Commands

```bash
# Orchestration
claude-swarm run <task>                      # Run a multi-agent swarm
  --agent role:cli:model                     # Specify agents (repeatable)
  --mode pipeline|parallel                   # Execution mode (default: pipeline)
  --no-tui                                   # Disable live dashboard

claude-swarm adapters                        # List available CLI adapters

# Coordination (for peer discovery + collaboration)
claude-swarm status                          # Dashboard overview
claude-swarm peers                           # List connected peers
claude-swarm rooms                           # List collaboration rooms
claude-swarm send <peer_id> <msg>            # Direct message
claude-swarm broadcast <room_id> <msg>       # Broadcast to room
claude-swarm history [--room <id>] [--search <term>]  # Message history
claude-swarm tasks <room_id>                 # List tasks
claude-swarm scratchpad <room_id>            # Shared memory entries
claude-swarm kill                            # Kill broker daemon
```

---

## Real-World Use Cases

### 1. Feature Building: "Build a Payment Flow"

```bash
npx claude-swarm run "Build a Stripe payment flow with webhook handling and retry logic" \
  --agent "architect:claude:claude-sonnet-4-6" \
  --agent "implementer:codex:o4-mini" \
  --agent "security-reviewer:gemini:gemini-2.5-pro"
```

**Flow:**
1. Architect designs payment state machine, webhook contracts, error handling strategy
2. Implementer sees the design, writes endpoint, webhook handler, retry logic
3. Security reviewer checks for PCI compliance, token handling, logging (no sensitive data)

**Result:** Production-ready payment flow with security review baked in.

### 2. Bug Fixing: "Fix the N+1 Query"

```bash
npx claude-swarm run "Fix the N+1 query in the dashboard user list endpoint" \
  --agent "analyst:claude" \
  --agent "fixer:codex" \
  --agent "verifier:claude"
```

**Flow:**
1. Analyst reads the code, identifies the N+1 pattern, suggests a fix approach
2. Fixer implements the fix with proper indexing
3. Verifier checks the fix works, verifies index strategy, checks for perf improvements

**Result:** Diagnosed, fixed, and verified without manual back-and-forth.

### 3. Code Review at Scale: "Review the Refactoring Branch"

```bash
npx claude-swarm run "Review this refactoring for correctness, performance, and style" \
  --agent "correctness:claude" \
  --agent "performance:codex" \
  --agent "style:gemini" \
  --mode parallel
```

**Flow:**
- All three run simultaneously
- No waiting
- Three independent perspectives in one command

**Result:** Multi-perspective review in the time it takes to run one agent.

### 4. Architecture Decision: "Design a Caching Layer"

```bash
npx claude-swarm run "Design a Redis caching layer for this API with cache invalidation strategy" \
  --agent "architect:claude:claude-opus-4-6" \
  --agent "implementer:codex:o4-mini" \
  --agent "performance-reviewer:claude:claude-sonnet-4-6"
```

**Flow:**
1. Architect designs the caching topology, TTLs, invalidation strategy
2. Implementer sees the design, codes the layer with proper error handling
3. Performance reviewer benchmarks it, checks for cache coherency issues

**Result:** Designed, implemented, and performance-validated in one run.

---

## Comparison with Alternatives

| Feature | Claude Swarm | Agent Teams | AMUX | Conductor |
|---------|---|---|---|---|
| **Multi-CLI** (Claude+Codex+Gemini) | ✓ | ✕ | ✕ | ✕ |
| **One-command orchestration** | ✓ | ✓ | ✕ | ✓ |
| **Live TUI dashboard** | ✓ | ✕ | Web UI | ✕ |
| **Per-role model selection** | ✓ | ✕ | ✕ | ✕ |
| **Pipeline mode** (sequential, context-aware) | ✓ | ✕ | ✕ | ✕ |
| **Parallel mode** | ✓ | ✓ | ✓ | ✓ |
| **MCP peer coordination** | ✓ | ✕ | ✕ | ✕ |
| **Shared scratchpad memory** | ✓ | Shared tasks | ✕ | ✕ |
| **Zero cloud dependency** | ✓ | ✓ | ✓ | ✕ |
| **Adapter pattern** (extensible) | ✓ | ✕ | ✕ | ✕ |
| **Open source** | ✓ | ✓ | ✓ | ✓ |

**Why Claude Swarm stands out:**

1. **Multi-CLI is unique.** No other tool orchestrates Claude, Codex, AND Gemini. You pick the best tool for each role.

2. **Pipeline mode changes everything.** Parallel-only tools force each agent to start from scratch. Pipeline mode lets later agents build on earlier ones—more efficient, better results.

3. **Per-role model selection.** Use Claude Sonnet for reasoning, Codex for speed, Haiku for lightweight tasks. Right tool, right role.

4. **Extensible by design.** Adding a new CLI is 20 lines. Adding a new tool is straightforward. Not betting the farm on the creator's roadmap.

---

## Architecture Internals

### Orchestrator Flow

```
User input: "Build a feature"
         ↓
Parse agent specs and mode
         ↓
Initialize SwarmRun object
         ↓
For each agent (pipeline) or all agents (parallel):
  ├─ Build role-specific prompt
  ├─ Spawn CLI subprocess
  ├─ Stream stdout/stderr
  ├─ Filter noise from output
  ├─ (Pipeline only) Pass prior outputs as context
  └─ Collect final output
         ↓
Summary: each agent's output, timing, status
```

### Prompt Construction

Role-specific instructions are baked in. For "planner" role:

```
You are the PLANNER in a multi-agent swarm.
Task: {user_task}

Context from previous agents:
(none for first agent)

Create a detailed implementation plan. Be specific about files, 
functions, and data structures. Output a structured plan that 
other agents can follow.
```

For "implementer" role in pipeline mode:

```
You are the IMPLEMENTER in a multi-agent swarm.
Task: {user_task}

Context from previous agents:

--- PLANNER output ---
{planner_output}
--- end PLANNER ---

Implement the code based on the plan/architecture provided. 
Write complete, working code. Follow the plan closely.
```

Each role gets tailored instructions. Each agent knows its role and has context.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_SWARM_PORT` | `7899` | Broker HTTP port |
| `CLAUDE_SWARM_DB` | `~/.claude-swarm.db` | SQLite database path |

---

## Extending Claude Swarm

### Adding a New CLI Adapter

Edit `src/adapters.ts`:

```typescript
const myAdapter: CLIAdapter = {
  name: "mycli",
  defaultModel: "my-model",
  available: () => commandExists("mycli"),
  spawn: ({ prompt, model, cwd }) => {
    return spawn("mycli", ["run", prompt, "--model", model], {
      cwd, stdio: ["ignore", "pipe", "pipe"],
    });
  },
};

// Add to registry
const adapters: Record<CLIType, CLIAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  mycli: myAdapter,  // Add here
};
```

Then use it:

```bash
npx claude-swarm run "Task" --agent "role:mycli:my-model"
```

---

## Common Patterns

### Pattern 1: Architect → Implement → Review

```bash
npx claude-swarm run "Build a caching layer" \
  --agent "architect:claude:claude-sonnet-4-6" \
  --agent "implementer:codex:o4-mini" \
  --agent "reviewer:gemini:gemini-2.5-pro"
```

Classic pipeline. Reasoning → Implementation → Independent verification.

### Pattern 2: Independent Multi-Perspective Review

```bash
npx claude-swarm run "Review for security, performance, and code quality" \
  --agent "security:claude" \
  --agent "performance:codex" \
  --agent "quality:gemini" \
  --mode parallel
```

All run simultaneously. Different perspectives, no waiting.

### Pattern 3: Rapid Iteration with Different Models

```bash
npx claude-swarm run "Optimize this SQL query" \
  --agent "analyzer:claude:claude-opus-4-6" \
  --agent "optimizer:claude:claude-sonnet-4-6" \
  --agent "verify:codex:o4-mini"
```

Leverage model strengths: Opus for reasoning, Sonnet for balanced, Codex for verification.

### Pattern 4: Debug + Fix + Verify

```bash
npx claude-swarm run "Fix the authentication bug in src/auth.ts" \
  --agent "debugger:claude" \
  --agent "fixer:codex" \
  --agent "tester:claude"
```

Sequential pipeline: diagnosis → implementation → testing.

---

## Limitations & Edge Cases

### When Claude Swarm May Not Be Ideal

1. **Single-agent tasks** — If one AI is enough, one command is overhead
2. **Highly interactive workflows** — If you need back-and-forth conversation, use the CLI directly
3. **Real-time feedback loops** — If agents need to see each other's output in real-time (not just at completion), this isn't the tool
4. **Very long context** — Token limits can be a constraint; orchestrator truncates large outputs to 30KB per agent

### Best Practices

- **Keep tasks focused** — A task per swarm. Don't try to "build the entire backend" in one run.
- **Match agents to roles** — Planner should be a reasoning model (Claude). Implementer should be fast (Codex). Reviewer can be independent (Gemini).
- **Use pipeline for dependent work** — Pipeline mode is slower but context-aware. Use it when later steps depend on earlier ones.
- **Use parallel for independent reviews** — No dependencies? Run in parallel. 3x faster.
- **Check available adapters first** — Run `claude-swarm adapters` to see what you have installed.

---

## Getting Started: Step-by-Step

### Step 1: Install Claude Swarm

```bash
git clone https://github.com/nghiack7/claude-swarm.git
cd claude-swarm
npm install
```

### Step 2: Ensure CLIs Are Installed

You need at least one of: Claude Code, Codex CLI, or Gemini CLI. Check your system:

```bash
which claude    # Claude Code
which codex     # Codex CLI
which gemini    # Gemini CLI
```

If missing, install them. They're all available as npm packages or system binaries.

### Step 3: Run a Swarm

Start simple:

```bash
npx tsx src/cli.ts run "Build a simple HTTP server in Node.js"
```

Watch the dashboard. See the agents run. Read the final output.

### Step 4: Customize

Try a custom pipeline:

```bash
npx tsx src/cli.ts run "Add authentication to the HTTP server" \
  --agent "planner:claude" \
  --agent "implementer:codex" \
  --agent "reviewer:gemini" \
  --mode pipeline
```

### Step 5: Parallel Review

Try parallel mode:

```bash
npx tsx src/cli.ts run "Review the HTTP server code" \
  --agent "correctness:claude" \
  --agent "performance:codex" \
  --agent "style:gemini" \
  --mode parallel
```

### Step 6: Explore MCP Features (Optional)

If you want peer coordination:

```bash
npx tsx src/cli.ts status          # See broker health
npx tsx src/cli.ts peers           # See connected agents
npx tsx src/cli.ts rooms           # See collaboration rooms
```

---

## Troubleshooting

### "CLI 'claude' not found"

The Claude Code CLI isn't installed or not in your PATH. Install it:

```bash
npm install -g claude-code
# or use the desktop app / web app
```

### "Broker not running"

MCP features require the broker. Start it:

```bash
npx tsx src/broker.ts
```

Or just use orchestration mode (run command), which starts the broker automatically.

### Output looks truncated

Large outputs are capped at 30KB to avoid token limits. This is intentional. For very large outputs, pipe to a file:

```bash
npx tsx src/cli.ts run "Task" > output.txt
```

### Agent got stuck or timed out

CLIs can hang if they require input. Use `--dangerously-skip-permissions` for Claude to skip confirmation prompts. For other CLIs, check their flags.

---

## Contributing

Claude Swarm is open source (MIT). Contributions welcome:

1. **New CLI adapters** — Edit `src/adapters.ts`, add your CLI in ~20 lines
2. **Better prompt instructions** — Improve role-specific prompts in `orchestrator.ts`
3. **MCP tools** — Add new coordination tools to the broker
4. **Performance** — Profile, optimize, parallelize
5. **Docs** — Improve this README, add examples, write blog posts

Check the repo for contributing guidelines.

---

## Why Claude Swarm Matters

**The future of AI-assisted development isn't about one super-powerful agent.** It's about **orchestrating multiple agents**, each with their own strengths, working together seamlessly.

- Planner thinks. Implementer codes. Reviewer checks.
- Security expert reviews. Performance expert benchmarks. Quality expert assesses.
- All in one command. No manual coordination. No copy-paste. Just orchestration.

Claude Swarm is what that looks like **right now**. It's early, but it's already powerful.

---

## Call to Action

If you're tired of switching between terminals and copy-pasting outputs:

**⭐ [Star claude-swarm on GitHub](https://github.com/nghiack7/claude-swarm)**

Try it on your next feature. Use it for code reviews. Let it handle the orchestration so you can focus on the work.

And if you build something cool with Claude Swarm, share it. Show the world what multi-agent orchestration looks like.

---

## Resources

- **GitHub:** [github.com/nghiack7/claude-swarm](https://github.com/nghiack7/claude-swarm)
- **Install:** `git clone https://github.com/nghiack7/claude-swarm.git && npm install`
- **Quick Start:** `npx tsx src/cli.ts run "Your task"`
- **Examples:** See README.md for more examples
- **MCP Tools:** 22 tools for peer coordination (optional)
- **License:** MIT

---

## FAQ

**Q: Do I need all three CLIs installed?**
A: No. Claude Swarm works with any combination. You can use just Claude, or just Codex, or all three. Start with what you have.

**Q: How much does this cost?**
A: Claude Swarm is free and open source. You pay for the underlying CLIs (Claude Code API, Codex, Gemini) if you use them. No separate subscription for orchestration.

**Q: Can I add my own CLI?**
A: Yes. ~20 lines in `src/adapters.ts`. It's designed to be extensible.

**Q: Is this a replacement for one-to-one conversation with an AI?**
A: No. Use this for orchestrated multi-agent work. Use the CLI directly for conversation.

**Q: How do I use this in production?**
A: You can run swarms from scripts. The CLI returns structured output (JSON mode coming). Integrate into your CI/CD pipeline for automated code generation + review.

**Q: What about privacy?**
A: Everything runs locally on `127.0.0.1`. No cloud. No phone-home. Your code never leaves your machine.

---

**Ready to orchestrate?**

```bash
npx tsx src/cli.ts run "Build a REST API with Express and TypeScript"
```

⭐ **[Star the repo. Try it today. Build something amazing.](https://github.com/nghiack7/claude-swarm)**

