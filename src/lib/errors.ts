// instanceof Error has proven unreliable for Supabase errors in this
// codebase (confirmed: an RPC error rendered as "[object Object]"
// instead of its real message) — possibly a bundling quirk duplicating
// the postgrest-js module, possibly something else. Rather than keep
// chasing that, this extracts a message defensively regardless of the
// thrown value's actual prototype chain.
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      // fall through to String() below
    }
  }
  return String(err);
}
