import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const supabaseConfigured = Boolean(url && anonKey);

// A real client is only created when both values are present. Every page
// that uses this checks `supabaseConfigured` first and shows a clear setup
// message instead of letting supabase-js throw on a missing URL.
export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function missingConfigMarkup(title) {
  return `
    <div class="cc-card cc-card-warn">
      <h2>${title}</h2>
      <p>This page needs a Supabase project to connect to. Add these to a <code>.env</code> file at the project root, then restart the dev server:</p>
      <pre>VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key</pre>
      <p class="cc-muted">Both values are safe to expose in the browser &mdash; they are the public project URL and the anon key, never the service-role key. Row Level Security in <code>schema.sql</code> is what actually protects the data.</p>
    </div>
  `;
}
