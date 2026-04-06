#!/usr/bin/env node
/**
 * Swarm Orchestrator — spawns and coordinates multi-CLI agents.
 * Supports pipeline (sequential) and parallel execution modes.
 */
import type { ChildProcess } from "node:child_process";
import { getAdapter, type CLIType } from "./adapters.js";

export type RunMode = "pipeline" | "parallel";
export type AgentStatus = "waiting" | "running" | "done" | "failed";
export type RunStatus = "running" | "done" | "failed" | "cancelled";

export interface AgentSpec {
  role: string;
  cli: CLIType;
  model?: string;
}

export interface RunningAgent {
  id: string;
  spec: AgentSpec;
  status: AgentStatus;
  process: ChildProcess | null;
  output: string;
  error: string;
  startedAt: number | null;
  completedAt: number | null;
  outputLines: string[];
}

export interface SwarmRun {
  id: string;
  task: string;
  mode: RunMode;
  status: RunStatus;
  agents: RunningAgent[];
  startedAt: number;
  completedAt: number | null;
}

export interface OrchestratorEvents {
  onAgentStart?: (agent: RunningAgent) => void;
  onAgentOutput?: (agent: RunningAgent, chunk: string) => void;
  onAgentDone?: (agent: RunningAgent) => void;
  onAgentError?: (agent: RunningAgent) => void;
  onRunDone?: (run: SwarmRun) => void;
}

let runCounter = 0;

function genRunId(): string {
  return `run_${Date.now().toString(36)}_${(++runCounter).toString(36)}`;
}

function genAgentId(role: string): string {
  return `agent_${role}_${Date.now().toString(36)}`;
}

/* ─── Prompt Construction ─── */

function buildPrompt(task: string, agent: AgentSpec, priorOutputs: Array<{ role: string; output: string }>): string {
  const lines: string[] = [];
  lines.push(`You are the ${agent.role.toUpperCase()} in a multi-agent swarm.`);
  lines.push(`Task: ${task}`);
  lines.push("");

  if (priorOutputs.length > 0) {
    lines.push("Context from previous agents:");
    for (const prior of priorOutputs) {
      lines.push(`\n--- ${prior.role.toUpperCase()} output ---`);
      // Truncate very long outputs to avoid token limits
      const trimmed = prior.output.length > 30_000
        ? prior.output.slice(0, 30_000) + "\n... [truncated]"
        : prior.output;
      lines.push(trimmed);
      lines.push(`--- end ${prior.role.toUpperCase()} ---`);
    }
    lines.push("");
  }

  // Role-specific instructions
  const roleInstructions: Record<string, string> = {
    planner: "Create a detailed implementation plan. Be specific about files, functions, and data structures. Output a structured plan that other agents can follow.",
    architect: "Design the architecture. Define components, interfaces, data flow, and key decisions. Be specific and concrete.",
    implementer: "Implement the code based on the plan/architecture provided. Write complete, working code. Follow the plan closely.",
    coder: "Write the code. Follow any plan or architecture provided. Be thorough and handle edge cases.",
    reviewer: "Review the implementation critically. Check for bugs, edge cases, security issues, and improvements. Be specific about what to fix.",
    tester: "Write tests for the implementation. Cover happy paths, edge cases, and error scenarios.",
    synthesizer: "Synthesize all outputs into a final summary. Highlight key decisions, files changed, and any remaining issues.",
  };

  const instruction = roleInstructions[agent.role.toLowerCase()] ?? `Fulfill your role as ${agent.role}. Be thorough and specific.`;
  lines.push(instruction);

  return lines.join("\n");
}

/* ─── Agent Execution ─── */

function runAgent(agent: RunningAgent, prompt: string, cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const adapter = getAdapter(agent.spec.cli);

    if (!adapter.available()) {
      agent.status = "failed";
      agent.error = `CLI '${agent.spec.cli}' not found. Install it first.`;
      agent.completedAt = Date.now();
      resolve();
      return;
    }

    agent.status = "running";
    agent.startedAt = Date.now();

    const model = agent.spec.model ?? adapter.defaultModel;
    const child = adapter.spawn({ prompt, model, cwd });
    agent.process = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      agent.output += text;
      // Keep last 50 lines for TUI display
      const newLines = text.split("\n").filter((l) => l.length > 0);
      agent.outputLines.push(...newLines);
      if (agent.outputLines.length > 50) {
        agent.outputLines = agent.outputLines.slice(-50);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      agent.error += chunk.toString();
    });

    child.on("close", (code) => {
      agent.completedAt = Date.now();
      agent.status = code === 0 ? "done" : "failed";
      agent.process = null;
      resolve();
    });

    child.on("error", (err) => {
      agent.completedAt = Date.now();
      agent.status = "failed";
      agent.error += err.message;
      agent.process = null;
      resolve();
    });
  });
}

/* ─── Orchestrator ─── */

export function parseAgentSpec(spec: string): AgentSpec {
  // Format: "role:cli:model" or "role:cli" or just "role"
  const parts = spec.split(":");
  const role = parts[0];
  const cli = (parts[1] as CLIType) ?? "claude";
  const model = parts[2] ?? undefined;
  return { role, cli, model };
}

export const DEFAULT_PIPELINE: AgentSpec[] = [
  { role: "planner", cli: "claude", model: "claude-sonnet-4-6" },
  { role: "implementer", cli: "claude", model: "claude-sonnet-4-6" },
  { role: "reviewer", cli: "claude", model: "claude-sonnet-4-6" },
];

export async function executeRun(
  task: string,
  agents: AgentSpec[],
  mode: RunMode,
  cwd: string,
  events?: OrchestratorEvents,
): Promise<SwarmRun> {
  const run: SwarmRun = {
    id: genRunId(),
    task,
    mode,
    status: "running",
    agents: agents.map((spec) => ({
      id: genAgentId(spec.role),
      spec,
      status: "waiting",
      process: null,
      output: "",
      error: "",
      startedAt: null,
      completedAt: null,
      outputLines: [],
    })),
    startedAt: Date.now(),
    completedAt: null,
  };

  try {
    if (mode === "pipeline") {
      await executePipeline(run, task, cwd, events);
    } else {
      await executeParallel(run, task, cwd, events);
    }
  } catch (err) {
    run.status = "failed";
  }

  run.completedAt = Date.now();
  const allDone = run.agents.every((a) => a.status === "done");
  const anyFailed = run.agents.some((a) => a.status === "failed");
  run.status = allDone ? "done" : anyFailed ? "failed" : "done";

  events?.onRunDone?.(run);
  return run;
}

async function executePipeline(
  run: SwarmRun,
  task: string,
  cwd: string,
  events?: OrchestratorEvents,
): Promise<void> {
  const priorOutputs: Array<{ role: string; output: string }> = [];

  for (const agent of run.agents) {
    const prompt = buildPrompt(task, agent.spec, priorOutputs);
    events?.onAgentStart?.(agent);
    await runAgent(agent, prompt, cwd);

    if (agent.status === "done") {
      priorOutputs.push({ role: agent.spec.role, output: agent.output });
      events?.onAgentDone?.(agent);
    } else {
      events?.onAgentError?.(agent);
      // In pipeline mode, stop on failure
      break;
    }
  }
}

async function executeParallel(
  run: SwarmRun,
  task: string,
  cwd: string,
  events?: OrchestratorEvents,
): Promise<void> {
  const promises = run.agents.map((agent) => {
    const prompt = buildPrompt(task, agent.spec, []);
    events?.onAgentStart?.(agent);
    return runAgent(agent, prompt, cwd).then(() => {
      if (agent.status === "done") {
        events?.onAgentDone?.(agent);
      } else {
        events?.onAgentError?.(agent);
      }
    });
  });

  await Promise.all(promises);
}
