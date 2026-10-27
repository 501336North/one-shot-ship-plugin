/**
 * Run an OSS API request, body read included, under one deadline (TR1). The one deadline shape for every CLI request.
 *
 * Aborting the request's signal is not enough on its own: measured on Node 25, with redirect: 'error' and garbage
 * collection running, an aborted stalled body read never settled. So the deadline both aborts the request (freeing the
 * connection where undici honours it) and rejects by itself in a Promise.race, whatever the request is doing. The
 * timer is cleared only once the request, body included, has settled. Same shape as the watcher's withDeadline
 * (watcher/src/api/with-deadline.ts); the two packages share no code.
 *
 * @param timeoutMs - How long the whole request, headers and body, may take
 * @param request - Starts the request with the given signal and reads its body
 * @param timeoutError - The error to throw once the deadline has passed (also when the request fails after the abort)
 */
export async function withDeadline<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
  timeoutError: () => Error
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } catch (err: unknown) {
    if (controller.signal.aborted) throw timeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
