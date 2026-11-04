/* Supabase settings. Leave empty to run without login (local-only mode).
   The anon key is meant to be public; data is protected by Row Level Security (see supabase/schema.sql). */
window.KW_CONFIG = {
  supabaseUrl: 'https://jqfheghcxlpyovivueko.supabase.co',      // e.g. 'https://abcdefghijklm.supabase.co'
  supabaseAnonKey: 'sb_publishable_BmH6rMK2X32glg_NIOqlow_mbD0qH6V',  // Project Settings → API → anon public key
  enableGoogle: true,  // true after enabling Google in Supabase → Authentication → Providers
  enableApple: false,   // true after enabling Apple (needs Apple Developer Program)
  freeDays: 5           // Days available without login (0 = no login gate). UI gate only: content files stay public.
};
