/**
 * Swarm TUI — live terminal dashboard for monitoring agent runs.
 * Pure ANSI, zero dependencies.
 */
import type { SwarmRun, RunningAgent } from "./orchestrator.js";

const C = {
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
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  clearScreen: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

const STATUS_BADGE: Record<string, string> = {
  waiting: `${C.bgBlue}${C.bold}${C.white} WAIT ${C.reset}`,
  starting: `${C.bgYellow}${C.bold} START ${C.reset}`,
  running: `${C.bgGreen}${C.bold} RUN  ${C.reset}`,
  done: `${C.bgCyan}${C.bold} DONE ${C.reset}`,
  failed: `${C.bgRed}${C.bold} FAIL ${C.reset}`,
};

const CLI_ICON: Record<string, string> = {
  claude: `${C.magenta}claude${C.reset}`,
  codex: `${C.green}codex${C.reset}`,
  gemini: `${C.blue}gemini${C.reset}`,
};

function elapsed(startMs: number, endMs?: number | null): string {
  const ms = (endMs ?? Date.now()) - startMs;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function progressBar(agent: RunningAgent, width: number): string {
  if (agent.status === "waiting") return C.dim + "░".repeat(width) + C.reset;
  if (agent.status === "done") return C.green + "█".repeat(width) + C.reset;
  if (agent.status === "failed") return C.red + "█".repeat(width) + C.reset;
  // Running — animate based on time
  const progress = Math.min(agent.outputLines.length / 10, 0.9);
  const filled = Math.floor(progress * width);
  return C.green + "█".repeat(filled) + C.dim + "░".repeat(width - filled) + C.reset;
}

function box(title: string, width: number): string {
  const pad = width - title.length - 4;
  return `╔═ ${C.bold}${title}${C.reset} ${"═".repeat(Math.max(pad, 0))}╗`;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + "...";
}

export function render(run: SwarmRun): string {
  const W = Math.min(process.stdout.columns || 80, 100);
  const lines: string[] = [];

  // Header
  lines.push(box(`🐝 CLAUDE SWARM`, W));
  lines.push(`║  Task: ${C.bold}${truncate(run.task, W - 12)}${C.reset}`);

  const runningCount = run.agents.filter((a) => a.status === "running").length;
  const doneCount = run.agents.filter((a) => a.status === "done").length;
  const failedCount = run.agents.filter((a) => a.status === "failed").length;
  const total = run.agents.length;

  lines.push(`║  Mode: ${C.cyan}${run.mode}${C.reset} | Agents: ${doneCount}/${total} done${failedCount > 0 ? ` | ${C.red}${failedCount} failed${C.reset}` : ""} | Elapsed: ${C.yellow}${elapsed(run.startedAt)}${C.reset}`);
  lines.push(`╠${"═".repeat(W - 2)}╣`);

  // Agent rows
  for (const agent of run.agents) {
    const badge = STATUS_BADGE[agent.status] ?? agent.status;
    const cli = CLI_ICON[agent.spec.cli] ?? agent.spec.cli;
    const model = agent.spec.model ?? "default";
    const bar = progressBar(agent, 12);

    lines.push(`║`);
    lines.push(`║  ${badge} ${C.bold}${agent.spec.role}${C.reset} (${cli}/${C.dim}${model}${C.reset})  ${bar}`);

    if (agent.status === "running" && agent.startedAt) {
      const lastLine = agent.outputLines[agent.outputLines.length - 1];
      const outputSize = agent.output.length > 1024
        ? `${(agent.output.length / 1024).toFixed(1)}KB`
        : `${agent.output.length}B`;
      lines.push(`║    ${C.dim}${elapsed(agent.startedAt)} elapsed | ${outputSize} output | ${agent.outputLines.length} lines${C.reset}`);
      if (lastLine) {
        lines.push(`║    ${C.cyan}> ${truncate(lastLine, W - 8)}${C.reset}`);
      }
    } else if (agent.status === "done" && agent.startedAt && agent.completedAt) {
      const outputSize = agent.output.length > 1024
        ? `${(agent.output.length / 1024).toFixed(1)}KB`
        : `${agent.output.length}B`;
      lines.push(`║    ${C.green}Completed in ${elapsed(agent.startedAt, agent.completedAt)}${C.reset} | ${outputSize} output`);
    } else if (agent.status === "failed") {
      const errLine = agent.error.split("\n").filter((l) => l.trim()).pop() ?? "Unknown error";
      lines.push(`║    ${C.red}${truncate(errLine, W - 8)}${C.reset}`);
    } else if (agent.status === "waiting") {
      lines.push(`║    ${C.dim}Waiting...${C.reset}`);
    }
  }

  lines.push(`║`);
  lines.push(`╠${"═".repeat(W - 2)}╣`);

  // Latest output from the active or most recently completed agent
  const activeAgent = run.agents.find((a) => a.status === "running")
    ?? [...run.agents].reverse().find((a) => a.status === "done");

  if (activeAgent && activeAgent.outputLines.length > 0) {
    lines.push(`║  ${C.dim}Latest output (${activeAgent.spec.role}):${C.reset}`);
    const showLines = activeAgent.outputLines.slice(-4);
    for (const line of showLines) {
      lines.push(`║  ${C.cyan}${truncate(line, W - 6)}${C.reset}`);
    }
  } else {
    lines.push(`║  ${C.dim}No output yet...${C.reset}`);
  }

  lines.push(`╚${"═".repeat(W - 2)}╝`);

  return lines.join("\n");
}

export class TUI {
  private interval: ReturnType<typeof setInterval> | null = null;
  private run: SwarmRun;

  constructor(run: SwarmRun) {
    this.run = run;
  }

  start(refreshMs = 500): void {
    process.stdout.write(C.hideCursor);
    this.draw();
    this.interval = setInterval(() => this.draw(), refreshMs);
  }

  draw(): void {
    process.stdout.write(C.clearScreen + render(this.run));
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(C.showCursor);
    // Final draw
    this.draw();
  }
}

/* ─── Static Summary (non-TUI output) ─── */

export function printSummary(run: SwarmRun): void {
  console.log(`\n${C.bold}${C.cyan}🐝 SWARM RUN COMPLETE${C.reset}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`Task: ${run.task}`);
  console.log(`Mode: ${run.mode} | Duration: ${elapsed(run.startedAt, run.completedAt)}`);
  console.log(`Status: ${run.status === "done" ? `${C.green}SUCCESS${C.reset}` : `${C.red}FAILED${C.reset}`}`);
  console.log(`${"─".repeat(60)}`);

  for (const agent of run.agents) {
    const badge = STATUS_BADGE[agent.status] ?? agent.status;
    const duration = agent.startedAt && agent.completedAt
      ? elapsed(agent.startedAt, agent.completedAt)
      : "—";
    console.log(`\n${badge} ${C.bold}${agent.spec.role}${C.reset} (${agent.spec.cli}/${agent.spec.model ?? "default"}) — ${duration}`);

    if (agent.output) {
      const lines = agent.output.split("\n").filter((l) => l.trim());
      const preview = lines.slice(0, 5).map((l) => `  ${C.dim}${truncate(l, 76)}${C.reset}`).join("\n");
      console.log(preview);
      if (lines.length > 5) {
        console.log(`  ${C.dim}... ${lines.length - 5} more lines${C.reset}`);
      }
    }

    if (agent.status === "failed" && agent.error) {
      console.log(`  ${C.red}Error: ${truncate(agent.error, 76)}${C.reset}`);
    }
  }
  console.log();
}
