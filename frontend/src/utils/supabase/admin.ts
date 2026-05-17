import { createClient } from "@supabase/supabase-js";

// Service-role client — server-side only. Never expose to the browser.
// Requires SUPABASE_SERVICE_KEY in the server environment.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
