# Claude Swarm: Multi-CLI Agent Orchestration
## YouTube Video Script (~8 minutes)

---

## OPENING (0:00–0:15)

**[VISUAL: Rapid cuts of terminal showing Claude, Codex, and Gemini CLIs running simultaneously]**

**VOICEOVER:**
"You're writing a feature. You open Claude Code. You write the plan. Then you switch to Codex for the implementation. Copy the output. Paste it. Switch to Gemini for a review. Copy again. Paste again. It's 2026—this shouldn't be your workflow."

**[VISUAL: Frustrated developer meme or dramatic pause]**

---

## THE PROBLEM (0:15–0:45)

**[VISUAL: Split-screen showing three separate terminal windows, all silo'd]**

**VOICEOVER:**
"Every AI coding tool runs in its own world. Claude doesn't talk to Codex. Codex doesn't talk to Gemini. They're three separate worlds, and you're the bus driver copying output between them."

**[VISUAL: Animated arrows showing manual copy-paste flow]**

"But what if they could talk? What if you could spawn all three agents from one command, have them work together in sequence or in parallel, and get a coordinated result?"

**[PAUSE]**

"That's Claude Swarm."

---

## THE SOLUTION (0:45–1:30)

**[VISUAL: Terminal showing: `claude-swarm run "Build a REST API"`]**

**VOICEOVER:**
"With Claude Swarm, you run one command. One prompt. Three agents fire up simultaneously—or in sequence, depending on your mode."

**[VISUAL: Live TUI dashboard showing progress bars for each agent]**

**VOICEOVER:**
"See real-time progress. Watch each agent's output stream in. No switching between terminals. No copy-paste. Just one unified orchestrator coordinating everything."

**[VISUAL: Show the TUI dashboard in motion]**
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

**VOICEOVER:**
"Claude plans the architecture. Codex writes the code. Gemini reviews the result. Each agent sees the output from the previous one. No manual work. No switching. Just orchestration."

---

## HOW IT WORKS (1:30–3:00)

### Execution Modes

**[VISUAL: Diagram 1 - Pipeline Mode]**

**VOICEOVER:**
"Claude Swarm has two execution modes. First: Pipeline mode."

```
Planner ──→ Implementer ──→ Reviewer
  output ────→ output ───────→ output
```

"Agents run sequentially. Each one sees all the previous outputs as context. Perfect when later steps depend on earlier ones—like architecture planning, then implementation, then code review."

**[VISUAL: Diagram 2 - Parallel Mode]**

**VOICEOVER:**
"Second: Parallel mode."

```
┌─ Security Reviewer
├─ Performance Auditor    (all run at once, same task)
└─ Code Quality Checker
```

"All agents run simultaneously with the same task. No shared context between them. Great for independent multi-perspective analysis—security review, performance audit, code quality check, all at once."

---

### The Architecture

**[VISUAL: Architecture diagram showing User → CLI → Orchestrator → Adapters → Claude/Codex/Gemini]**

**VOICEOVER:**
"Under the hood, Claude Swarm has two layers."

"Layer 1 is the Orchestrator. It spawns CLI processes, constructs role-specific prompts, manages their lifecycles, and collects output. This is the new part that makes multi-CLI orchestration possible."

"Layer 2 is the Broker—an MCP server running on localhost:7899. It handles peer discovery, rooms for collaboration, message queues, task delegation, and a shared scratchpad memory. If you want, you can use Claude Swarm as an MCP server too, for real-time collaboration between multiple Claude Code sessions."

**[VISUAL: Show MCP tool icons]**

"22 MCP tools out of the box. Everything from broadcasting messages to managing shared tasks."

---

## QUICK START (3:00–4:15)

**[VISUAL: Terminal with code examples, typing them out live]**

### Example 1: Default Pipeline

**VOICEOVER:**
"Let's run through some examples. First, the simplest one."

```bash
npx tsx src/cli.ts run "Build a todo REST API with Express and TypeScript"
```

**VOICEOVER:**
"No flags. Claude Swarm uses its default pipeline: Planner → Implementer → Reviewer. Each agent gets a role-specific prompt."

---

### Example 2: Custom Agents with Model Selection

**VOICEOVER:**
"Want to pick specific CLIs and models? Pass agent specs."

```bash
npx tsx src/cli.ts run "Fix the auth bug in src/auth.ts" \
  --agent "analyst:claude:claude-sonnet-4-6" \
  --agent "fixer:codex:o4-mini" \
  --agent "reviewer:claude:claude-haiku-4-5-20251001"
```

**VOICEOVER:**
"Format is `role:cli:model`. Role becomes the agent's persona in the prompt. CLI picks Claude, Codex, or Gemini. Model selects the specific version. You can mix and match freely."

---

### Example 3: Parallel Mode

**VOICEOVER:**
"Or run all agents in parallel for independent reviews."

```bash
npx tsx src/cli.ts run "Review this codebase for security issues" \
  --agent "security:claude" \
  --agent "deps:codex" \
  --agent "secrets:gemini" \
  --mode parallel
```

**VOICEOVER:**
"Three agents, three different CLIs, all running at the same time. Claude does security review, Codex checks dependencies, Gemini looks for secrets. Parallel review without manual coordination."

---

### Example 4: Check Available Adapters

**VOICEOVER:**
"Not sure which CLIs you have installed? Check adapters."

```bash
npx tsx src/cli.ts adapters
```

```
CLI Adapters

  claude ● available (default model: claude-sonnet-4-6)
  codex  ● available (default model: o4-mini)
  gemini ✕ not found (default model: gemini-2.5-pro)
```

**VOICEOVER:**
"Green dot means it's installed. Red X means install it first."

---

## WHY THIS MATTERS (4:15–5:30)

**[VISUAL: Side-by-side comparison table]**

**VOICEOVER:**
"So why does Claude Swarm matter? Because it's the first tool that orchestrates multiple AI CLIs from one command."

**[VISUAL: Show comparison table from README]**

| Feature | Claude Swarm | Others |
|---------|---|---|
| Multi-CLI (Claude+Codex+Gemini) | ✓ | ✕ |
| One-command orchestration | ✓ | ✓ |
| Per-role model selection | ✓ | ✕ |
| Live TUI dashboard | ✓ | Sometimes |
| Pipeline + parallel modes | ✓ | Parallel only |
| MCP peer coordination | ✓ | ✕ |
| Zero cloud dependency | ✓ | ✓ |
| Adapter pattern (extensible) | ✓ | ✕ |

**VOICEOVER:**
"You get multi-CLI orchestration. You get live monitoring. You get both pipeline and parallel modes—not just parallel. You get per-role model selection, so a planner can use Claude Sonnet while an implementer uses Codex. And it's all local—no API keys for the swarm layer. No cloud vendor lock-in."

**[PAUSE]**

"And the adapter pattern means adding a new CLI is just ~20 lines of code. Anthropic releases a new model? Add an adapter. You have an internal CLI? Add an adapter. It's extensible by design."

---

## REAL-WORLD USE CASES (5:30–6:30)

**[VISUAL: Each use case as a slide with animated example]**

**VOICEOVER:**
"Let's look at where this actually helps."

### 1. Feature Building
**"Build a payment flow with Stripe integration"**
- Planner designs the flow and payment states
- Implementer writes the code
- Reviewer checks for security and PCI compliance
- All in one run, no switching

### 2. Bug Fixing
**"Fix the N+1 query in the user dashboard"**
- Analyst diagnoses the problem
- Fixer implements the fix
- Reviewer confirms it works and checks for perf regressions

### 3. Code Review at Scale
**"Review the refactoring branch for correctness, performance, and security"**
- Parallel mode, three agents with different perspectives
- No waiting—all review simultaneously
- Get three independent verdicts in one go

### 4. Architecture Decisions
**"Design a caching layer for this API"**
- Architect proposes the design
- Implementer codes it
- Performance reviewer benchmarks it
- All in sequence with shared context

**VOICEOVER:**
"Every one of these is smoother with Claude Swarm. You don't have to manually chase outputs. You don't have to copy-paste. You don't have to wait for one agent while another sits idle. Just describe what you want, pick your agents, and let them work."

---

## INSTALLATION & SETUP (6:30–6:50)

**[VISUAL: Terminal showing install commands]**

**VOICEOVER:**
"Installation is straightforward."

```bash
git clone https://github.com/nghiack7/claude-swarm.git
cd claude-swarm
npm install
npx tsx src/cli.ts run "Your task here"
```

**VOICEOVER:**
"Clone the repo, install dependencies, and you're ready to run swarms. Node 20+, and you need Claude Code, Codex CLI, or Gemini CLI installed on your machine. Everything runs locally."

---

## CLOSING (6:50–7:55)

**[VISUAL: Montage of different swarm runs with different agents and modes]**

**VOICEOVER:**
"Claude Swarm is still early, but it's already powerful. It removes the friction of multi-CLI orchestration. It gives you a unified interface for coordinating different AI agents. And it does it all locally—no phone-home, no subscriptions, no vendor dependencies."

**[VISUAL: Show GitHub repo]**

**VOICEOVER:**
"If this resonates with you—if you're tired of switching between terminals and copy-pasting outputs—check out claude-swarm on GitHub. Give it a star, try it on your next project, and let the creator know what you think."

**[VISUAL: GitHub URL prominently displayed]**

```
github.com/nghiack7/claude-swarm
```

**VOICEOVER:**
"The next generation of AI-assisted coding isn't about one super-powerful agent. It's about orchestrating multiple agents, each with their own strengths, working together seamlessly. Claude Swarm shows what that looks like."

**[VISUAL: End card with repo URL and subscribe prompt]**

**VOICEOVER:**
"Thanks for watching. Star the repo, try Claude Swarm, and let's build the future of multi-agent development tools together."

---

## CTA (7:55–8:00)

**[VISUAL: YouTube card + end screen]**

- **Primary CTA:** ⭐ Star on GitHub: github.com/nghiack7/claude-swarm
- **Secondary CTA:** Subscribe for more AI dev tools coverage
- **Tertiary CTA:** Check the README for full docs and examples

---

## NOTES FOR PRODUCTION

### B-Roll / Visual Assets Needed
1. Terminal screen recordings of actual swarm runs
2. Animated diagrams for pipeline vs. parallel modes
3. TUI dashboard video (showing live progress)
4. Side-by-side comparison table
5. Architecture diagram with annotations
6. GitHub repo card/screenshot

### Voiceover Tone
- **Pace:** Brisk but conversational (not robotic)
- **Energy:** Building excitement—this solves a real problem
- **Technical level:** Intermediate developer (assumes familiarity with CLI tools and AI coding assistants, but not deep swarm coordination knowledge)

### Timing Notes
- Total runtime: ~8 minutes
- Opening hook: 15s (critical for retention)
- Problem statement: 30s (relatable pain)
- Solution reveal: 45s (AHA moment)
- How it works: 90s (technical depth)
- Examples: 75s (practical, digestible)
- Why it matters: 75s (competitive positioning)
- Use cases: 60s (relatability)
- Install & CTA: 85s (low friction)

### Potential Title Variations
1. **"Stop Copy-Pasting Between AI Agents"** (pain-focused)
2. **"Multi-AI Orchestration in One Command"** (feature-focused)
3. **"Claude + Codex + Gemini: Working Together"** (collaboration-focused)
4. **"The Future of AI-Assisted Development"** (vision-focused)

### Tags
`claude` `codex` `gemini` `ai` `development` `orchestration` `automation` `coding` `agents` `multi-cli` `claude-swarm` `open-source`

