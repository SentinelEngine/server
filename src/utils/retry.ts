/**
 * Generic async retry with exponential backoff.
 *
 * @param fn       Async function to retry
 * @param retries  Maximum number of attempts (default: 3)
 * @param baseMs   Initial delay in ms (doubles each attempt)
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
