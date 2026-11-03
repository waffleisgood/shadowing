/* Supabase settings. Leave empty to run without login (local-only mode).
   The anon key is meant to be public; data is protected by Row Level Security (see supabase/schema.sql). */
window.KW_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcdefghijklm.supabase.co'
  supabaseAnonKey: '',  // Project Settings → API → anon public key
  enableGoogle: false,  // true after enabling Google in Supabase → Authentication → Providers
  enableApple: false    // true after enabling Apple (needs Apple Developer Program)
};
