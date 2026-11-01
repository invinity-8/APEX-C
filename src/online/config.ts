/**
 * Client configuration. Only PUBLIC values may live here (they end up in the browser bundle).
 *
 *   VITE_SUPABASE_URL              – project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  – publishable (or legacy anon) key, protected by RLS
 *   VITE_APEX_ALLOW_DEMO           – "true" shows the local demo even when online mode is configured
 *
 * The Supabase SECRET key must never be given a VITE_ prefix.
 */
const env = import.meta.env;

export interface OnlineConfig {
  url: string;
  publishableKey: string;
}

export const onlineConfig: OnlineConfig | null =
  env.VITE_SUPABASE_URL && (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)
    ? { url: env.VITE_SUPABASE_URL as string, publishableKey: (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY) as string }
    : null;

/**
 * The local demo never touches the shared campaign, so it cannot bypass authentication.
 * Production builds NEVER fall back to it silently: without online configuration they show a
 * setup notice instead. The demo is reachable only in development, or explicitly with
 * VITE_APEX_ALLOW_DEMO=true and the URL parameter ?demo.
 */
export const demoAllowed: boolean = env.DEV || env.VITE_APEX_ALLOW_DEMO === 'true';

/** Names of the missing public build variables (for the setup notice). */
export const missingConfig: string[] = [
  ...(env.VITE_SUPABASE_URL ? [] : ['VITE_SUPABASE_URL']),
  ...(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY ? [] : ['VITE_SUPABASE_PUBLISHABLE_KEY']),
];
