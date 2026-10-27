/**
 * Run an OSS API request, body read included, under one deadline (SR10).
 *
 * Aborting a fetch's signal is not enough on its own: measured on Node 25, with redirect: 'error' and
 * garbage collection running, an abort (from AbortSignal.timeout or an AbortController alike) does
 * not end a stalled body read, which then hangs until the server closes the socket. So the deadline
 * both aborts the request (freeing the connection where undici honours it) and rejects the caller's
 * promise itself, with a TimeoutError, whatever the request is doing.
 *
 * @param timeoutMs - How long the whole request, headers and body, may take
 * @param request - Starts the request with the given signal and reads its body
 */
export async function withDeadline<T>(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeout = new DOMException('The OSS API request timed out', 'TimeoutError');
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
