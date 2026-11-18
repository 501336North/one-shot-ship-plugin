/**
 * Read an HTTP response body with a byte cap, so a hostile or broken server cannot make the CLI buffer an
 * unbounded answer. Shared by the manifest fetch and the keyed API fetches.
 */

/** The body as text, or null once it is (announced or streamed) larger than `maxBytes`. */
export async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}
