// Supabase browser client. Reads the project URL and publishable (anon) key from
// Vite env so the same build can point at production, a Vercel preview project,
// or a local `supabase start` stack (.env.local). Falls back to production.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { resolveBrowserSupabaseConfig } from './browserConfig.mjs';

const { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY } = resolveBrowserSupabaseConfig(import.meta.env);

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
