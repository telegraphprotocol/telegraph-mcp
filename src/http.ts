export async function getJson(url: string, timeoutMs = 30_000): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).pathname}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Caches a slow, rarely changing GET for ttlMs.
export function cached<T>(load: () => Promise<T>, ttlMs = 5 * 60_000): () => Promise<T> {
  let value: T | undefined;
  let at = 0;
  return async () => {
    if (value === undefined || Date.now() - at > ttlMs) {
      value = await load();
      at = Date.now();
    }
    return value;
  };
}
