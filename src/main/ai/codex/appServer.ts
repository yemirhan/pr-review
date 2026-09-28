import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathWithFallbacks } from '../../system/shellPath';

/**
 * Minimal JSON-RPC client for `codex app-server` over stdio.
 *
 * The app server speaks newline-delimited JSON-RPC 2.0. We keep one
 * long-lived process for the whole app (threads are cheap; process startup
 * and MCP server boot are not), lazily spawned on first use and respawned
 * if it dies. See `codex app-server generate-ts` for the protocol types the
 * shapes below are derived from.
 */

export interface RpcNotification {
  method: string;
  params: Record<string, unknown>;
}

export class CodexRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class CodexNotInstalledError extends Error {
  constructor() {
    super(
      'Codex CLI was not found. Install it with `npm install -g @openai/codex` (or switch the AI provider in Settings).'
    );
  }
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
}

type ServerRequestHandler = (
  method: string,
  params: Record<string, unknown>
) => unknown | Promise<unknown>;

function resolveCodexPath(): string {
  const candidates = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.local/bin/codex'),
    join(homedir(), '.npm-global/bin/codex'),
    join(homedir(), '.volta/bin/codex')
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH lookup (process.env.PATH is merged with the login
  // shell's PATH at startup, so this matches what the terminal would run).
  return 'codex';
}

const CLIENT_INFO = { name: 'pr-review', title: 'PR Review', version: '0.1.0' };

export class CodexAppServer extends EventEmitter {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private serverRequestHandler: ServerRequestHandler | null = null;
  /** Thread ids created by the *current* process; lost when it restarts. */
  readonly liveThreads = new Set<string>();

  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  get running(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** Spawn + initialize handshake (idempotent). */
  ensureStarted(): Promise<void> {
    if (this.running && !this.starting) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const bin = resolveCodexPath();
    const child = spawn(bin, ['app-server'], {
      env: { ...process.env, PATH: pathWithFallbacks(), NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    this.buffer = '';
    this.liveThreads.clear();

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.emit('stderr', chunk);
    });

    const spawned = new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        cleanup();
        reject(err.code === 'ENOENT' ? new CodexNotInstalledError() : err);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        child.off('error', onError);
        child.off('spawn', onSpawn);
      };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });

    child.on('error', (err) => {
      this.failAll(err);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.liveThreads.clear();
      this.failAll(
        new Error(`codex app-server exited (${signal ?? `code ${code ?? '?'}`})`)
      );
      this.emit('exit', { code, signal });
    });

    await spawned;

    await this.request('initialize', {
      clientInfo: CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        // We don't render these, so ask the server not to send them.
        optOutNotificationMethods: [
          'mcpServer/startupStatus/updated',
          'thread/tokenUsage/updated',
          'item/reasoning/summaryTextDelta',
          'item/reasoning/textDelta',
          'item/reasoning/summaryPartAdded',
          'rawResponseItem/completed',
          'rawResponse/completed'
        ]
      }
    });
    this.notify('initialized', {});
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.liveThreads.clear();
    if (child && child.exitCode === null) {
      try {
        child.stdin?.end();
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    this.failAll(new Error('codex app-server stopped'));
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private write(msg: Record<string, unknown>): void {
    const child = this.child;
    if (!child || !child.stdin || !child.stdin.writable) {
      throw new Error('codex app-server is not running');
    }
    child.stdin.write(JSON.stringify(msg) + '\n');
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  request<T = unknown>(method: string, params: Record<string, unknown> | undefined): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.emit('stderr', `unparseable app-server line: ${line.slice(0, 200)}`);
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    const hasId = msg.id !== undefined && msg.id !== null;
    const method = typeof msg.method === 'string' ? msg.method : null;

    if (hasId && method) {
      // Server → client request (approvals, user input, ...).
      void this.handleServerRequest(msg.id as number | string, method, (msg.params ?? {}) as Record<string, unknown>);
      return;
    }
    if (hasId) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const e = msg.error as { code?: number; message?: string; data?: unknown };
        p.reject(new CodexRpcError(e.code ?? -1, e.message ?? 'app-server error', e.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (method) {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (method === 'thread/started') {
        const t = (params.thread as { id?: string } | undefined)?.id;
        if (t) this.liveThreads.add(t);
      }
      this.emit('notification', { method, params } satisfies RpcNotification);
    }
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    try {
      const result = this.serverRequestHandler
        ? await this.serverRequestHandler(method, params)
        : undefined;
      if (result === undefined) {
        this.write({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unsupported server request: ${method}` }
        });
      } else {
        this.write({ jsonrpc: '2.0', id, result });
      }
    } catch (err) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: (err as Error).message }
      });
    }
  }
}

let singleton: CodexAppServer | null = null;

export function getCodexAppServer(): CodexAppServer {
  if (!singleton) singleton = new CodexAppServer();
  return singleton;
}

export function stopCodexAppServer(): void {
  singleton?.stop();
  singleton = null;
}
