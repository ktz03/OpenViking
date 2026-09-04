export function enqueue(type: string, sessionId: string, payload: Record<string, any>, options?: { createdAt?: number }): Promise<{ ok: boolean; path?: string; error?: string }>;
export function listPending(): Promise<Array<{ filename: string; entry: Record<string, any> }>>;
export function drainPendingForSession(
  fetchJSON: (path: string, init?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  log: (stage: string, data?: any) => void,
  options?: {
    sessionId?: string;
    maxRounds?: number;
    timeBudgetMs?: number;
  },
): Promise<{
  ok: boolean;
  remaining: number;
  replayed: number;
  failed: number;
  rounds: number;
  reason?: string;
}>;
export function replayPending(
  fetchJSON: (path: string, init?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  log: (stage: string, data?: any) => void,
  options?: { sessionId?: string },
): Promise<{ replayed: number; failed: number; skipped: number; deferred: number }>;
export function cleanStale(): Promise<number>;
