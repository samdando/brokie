// Your Supabase project (both values are public by design).
// Can also be set at build time with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
export const isConfigured = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 10;
