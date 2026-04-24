/**
 * Daemon probe helpers (ADR-18 / Task #42 / Phase 1).
 *
 * These functions reference daemon surface area that does NOT exist yet in
 * v1.1.0 — calling them fails, which is the TDD signal. Phase 2+ implements
 * the daemon and these calls start resolving.
 *
 * The probe talks to the same `127.0.0.1:8765` endpoint AgentManager uses
 * today; after Phase 2 the endpoint belongs to the daemon instead of the UI
 * exe. The HTTP shape stays the same for the endpoints tested here; what
 * changes is process ownership.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

/** %LOCALAPPDATA%\AgentManager — daemon state root.
 *
 * Respects `AGENTMANAGER_STATE_DIR` so the daemon e2e project can
 * probe a tmp dir that the daemon process was launched with.
 */
export function agentManagerStateDir(): string {
  const override = process.env.AGENTMANAGER_STATE_DIR;
  if (override) return override;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'AgentManager');
}

export interface PidFile {
  pid: number;
  startTimeEpoch: number;
  daemonVersion: string;
}

/** Read + parse the daemon pid file. Throws if missing or malformed. */
export function readPidFile(): PidFile {
  const file = path.join(agentManagerStateDir(), 'daemon.pid');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as PidFile;
  if (!parsed || typeof parsed.pid !== 'number') {
    throw new Error(`malformed pid file: ${raw}`);
  }
  return parsed;
}

/** Read the per-install bearer token used for HTTP+WS auth to the daemon. */
export function readToken(): string {
  const file = path.join(agentManagerStateDir(), 'token');
  return fs.readFileSync(file, 'utf8').trim();
}

/** Check whether a PID is alive (Windows-only). Uses `tasklist` for portability. */
export function pidIsAlive(pid: number): boolean {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
    return out.trim().length > 0 && !out.toLowerCase().includes('no tasks');
  } catch {
    return false;
  }
}

/** Count processes whose image name starts with `AgentManager`. */
export function agentManagerProcessCount(): number {
  try {
    const out = execSync(
      `tasklist /FI "IMAGENAME eq AgentManager.exe" /FO CSV /NH`,
      { encoding: 'utf8' },
    );
    const daemon = execSync(
      `tasklist /FI "IMAGENAME eq AgentManager-Daemon.exe" /FO CSV /NH`,
      { encoding: 'utf8' },
    );
    let count = 0;
    for (const block of [out, daemon]) {
      const lines = block.trim().split(/\r?\n/).filter((l) => l.length > 0);
      for (const line of lines) {
        if (line.toLowerCase().includes('agentmanager')) count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** Walk netstat output and assert the daemon bound only on loopback. */
export function listeningAddressesFor(port: number): string[] {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const hits: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+([^\s]+):(\d+)\s+[^\s]+\s+LISTENING/);
    if (m && Number(m[2]) === port) hits.push(m[1]);
  }
  return hits;
}

/** HTTP GET against the daemon with the bearer token. */
export async function daemonGet(pathname: string): Promise<Response> {
  const token = readToken();
  return fetch(`http://127.0.0.1:8765${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** HTTP PUT with token. */
export async function daemonPut(pathname: string, body?: unknown): Promise<Response> {
  const token = readToken();
  return fetch(`http://127.0.0.1:8765${pathname}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

/** HTTP POST with token. */
export async function daemonPost(pathname: string, body?: unknown): Promise<Response> {
  const token = readToken();
  return fetch(`http://127.0.0.1:8765${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}
