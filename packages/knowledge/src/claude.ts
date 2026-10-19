/**
 * The Claude Code CLI as an AI backend: `claude -p`, signed in the way the
 * user already uses it, so Eyrie holds no API key.
 *
 * Eyrie must never let a model act on the repository, so the CLI runs with
 * no tools, no MCP servers, no user or project settings (so no hooks or
 * plugins), no saved session and no slash commands, in an empty temporary
 * folder rather than the repository. The prompt goes in on stdin.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiBackend, AiRequest, AiResult } from './analysis.js';

export interface ClaudeCodeOptions {
  /** The executable; `claude` on PATH by default. */
  command?: string;
  model?: string;
  /** Environment for the CLI; the current one by default. Its PATH must find the command. */
  env?: NodeJS.ProcessEnv;
}

/** The arguments `claude` runs with. Exported for tests. */
export function claudeArgs(request: Pick<AiRequest, 'system' | 'schema'>, model?: string): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.schema),
    '--system-prompt',
    request.system,
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    'local',
    '--no-session-persistence',
    '--disable-slash-commands',
    ...(model ? ['--model', model] : []),
  ];
}

/** Reads `claude --output-format json`'s single result object. Exported for tests. */
export function parseClaudeOutput(stdout: string): AiResult {
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`claude printed something other than JSON: ${stdout.slice(0, 200)}`);
  }
  if (result.is_error) throw new Error(`claude reported an error: ${String(result.result ?? result.subtype ?? 'unknown')}`.slice(0, 500));
  let json = result.structured_output;
  if (json === undefined && typeof result.result === 'string') {
    const text = result.result.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('claude answered without the requested JSON');
    }
  }
  const models = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage) : [];
  const usage: Record<string, unknown> = {};
  const counters = (result.usage ?? {}) as Record<string, unknown>;
  for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) if (typeof counters[key] === 'number') usage[key] = counters[key];
  if (typeof result.total_cost_usd === 'number') usage.costUsd = result.total_cost_usd;
  if (typeof result.duration_ms === 'number') usage.durationMs = result.duration_ms;
  return { json, model: models[0], usage };
}

export function claudeCodeBackend(opts: ClaudeCodeOptions = {}): AiBackend {
  const command = opts.command ?? 'claude';
  return {
    name: 'claude-code',
    run: (request) =>
      new Promise<AiResult>((resolve, reject) => {
        const cwd = mkdtempSync(join(tmpdir(), 'eyrie-ai-'));
        // Not a nested session of whatever Claude Code session started Eyrie.
        const env: NodeJS.ProcessEnv = {};
        for (const [k, v] of Object.entries(opts.env ?? process.env)) if (!/^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION)/.test(k)) env[k] = v;
        const child = spawn(command, claudeArgs(request, opts.model), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (err: Error | null, value?: AiResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', abort);
          rmSync(cwd, { recursive: true, force: true });
          if (err) reject(err);
          else resolve(value!);
        };
        const abort = () => {
          child.kill();
          finish(new Error('cancelled'));
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(new Error(`claude did not answer within ${Math.round(request.timeoutMs / 1000)} s`));
        }, request.timeoutMs);
        request.signal?.addEventListener('abort', abort, { once: true });
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
        child.on('error', (err) => finish(new Error(`could not run ${command}: ${err.message}`)));
        child.on('close', (code) => {
          if (code !== 0 && !stdout.trim()) return finish(new Error(`claude exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
          try {
            finish(null, parseClaudeOutput(stdout));
          } catch (err) {
            finish(err as Error);
          }
        });
        child.stdin.end(request.prompt);
      }),
  };
}
