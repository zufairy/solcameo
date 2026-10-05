/**
 * Race a promise against a wall-clock timeout. Resolves/rejects with the promise
 * if it settles first; rejects with `new Error(msg)` if `ms` elapses first. The
 * timer is always cleared so a winning promise can't leave a dangling timeout.
 * NOTE: a lost race does NOT cancel the underlying work — use it as a fail-fast
 * backstop for a hop that already has its own (here, too-slow) internal bound.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(msg)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
