// supabase/functions/_shared/cors.ts
//
// Every function called from the browser (via supabase.functions.invoke
// or a direct fetch) needs this. The browser sends a CORS preflight
// OPTIONS request before the real POST whenever the request carries a
// custom header like Authorization or Content-Type — and that preflight
// never includes Authorization (browsers strip it by design). Without
// explicit OPTIONS handling, that preflight can get rejected by the
// platform's own JWT check before the function's own code ever runs,
// which blocks the real request from ever being sent at all.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
