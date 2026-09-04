// Supabase browser client. Reads the project URL and publishable (anon) key from
// Vite env so the same build can point at production, a Vercel preview project,
// or a local `supabase start` stack (.env.local). Falls back to production.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const PRODUCTION_URL = "https://xdaienqjbybomctsoiro.supabase.co";
const PRODUCTION_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkYWllbnFqYnlib21jdHNvaXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzODQ3ODksImV4cCI6MjA3MTk2MDc4OX0.BPyPSw_mQ3hb7Y4dm7bRSwGzM71TYCTSvIL5SPRcAfk";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || PRODUCTION_URL;
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
  || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  || PRODUCTION_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
