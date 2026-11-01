/**
 * Client configuration. Only PUBLIC values may live here (they end up in the browser bundle).
 *
 *   VITE_SUPABASE_URL              – project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  – publishable (or legacy anon) key, protected by RLS
 *   VITE_APEX_ALLOW_DEMO           – "true" shows the local demo even when online mode is configured
 *   VITE_APEX_ALLOW_SIGNUP         – "true" shows "Create account" on the login page
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
 * When online mode is configured it is still hidden in production builds unless explicitly allowed.
 */
export const demoAllowed: boolean = !onlineConfig || env.DEV || env.VITE_APEX_ALLOW_DEMO === 'true';

export const signupAllowed: boolean = env.VITE_APEX_ALLOW_SIGNUP === 'true';
