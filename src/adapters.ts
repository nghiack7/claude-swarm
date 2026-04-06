#!/usr/bin/env node
/**
 * CLI Adapters — spawn and manage different AI CLI tools.
 * Supports Claude Code, Codex CLI, and Gemini CLI.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";

export type CLIType = "claude" | "codex" | "gemini";

export interface SpawnOptions {
  prompt: string;
  model?: string;
  cwd?: string;
}

export interface CLIAdapter {
  readonly name: CLIType;
  readonly defaultModel: string;
  available(): boolean;
  spawn(opts: SpawnOptions): ChildProcess;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/* ─── Claude Code ─── */

const claudeAdapter: CLIAdapter = {
  name: "claude",
  defaultModel: "claude-sonnet-4-6",
  available: () => commandExists("claude"),
  spawn: ({ prompt, model, cwd }) => {
    const args = ["-p", prompt, "--output-format", "text"];
    if (model) args.push("--model", model);
    return spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  },
};

/* ─── Codex CLI ─── */

const codexAdapter: CLIAdapter = {
  name: "codex",
  defaultModel: "o4-mini",
  available: () => commandExists("codex"),
  spawn: ({ prompt, model, cwd }) => {
    const args = ["exec", prompt];
    if (model) args.push("--model", model);
    return spawn("codex", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  },
};

/* ─── Gemini CLI ─── */

const geminiAdapter: CLIAdapter = {
  name: "gemini",
  defaultModel: "gemini-2.5-pro",
  available: () => commandExists("gemini"),
  spawn: ({ prompt, model, cwd }) => {
    const args = ["-p", prompt];
    if (model) args.push("--model", model);
    return spawn("gemini", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  },
};

/* ─── Registry ─── */

const adapters: Record<CLIType, CLIAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(cli: CLIType): CLIAdapter {
  const adapter = adapters[cli];
  if (!adapter) throw new Error(`Unknown CLI: ${cli}. Supported: ${Object.keys(adapters).join(", ")}`);
  return adapter;
}

export function listAdapters(): Array<{ name: CLIType; available: boolean; defaultModel: string }> {
  return Object.values(adapters).map((a) => ({
    name: a.name,
    available: a.available(),
    defaultModel: a.defaultModel,
  }));
}

export function detectAvailableCLIs(): CLIType[] {
  return Object.values(adapters).filter((a) => a.available()).map((a) => a.name);
}
