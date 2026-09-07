const PRODUCTION_URL = "https://xdaienqjbybomctsoiro.supabase.co";
const PRODUCTION_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkYWllbnFqYnlib21jdHNvaXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzODQ3ODksImV4cCI6MjA3MTk2MDc4OX0.BPyPSw_mQ3hb7Y4dm7bRSwGzM71TYCTSvIL5SPRcAfk";

// The browser and deployment check must target the same database.
export function resolveBrowserSupabaseConfig(env) {
  return {
    url: env.VITE_SUPABASE_URL?.trim() || PRODUCTION_URL,
    key: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
      || env.VITE_SUPABASE_ANON_KEY?.trim() || PRODUCTION_PUBLISHABLE_KEY,
  };
}
