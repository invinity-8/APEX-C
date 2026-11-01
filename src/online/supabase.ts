/**
 * Supabase client in the browser – used ONLY for Realtime (live version pings on the
 * campaign's secret broadcast topic). Sign-in does not use Supabase Auth any more:
 * the APEX server issues its own HttpOnly session cookie.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { onlineConfig } from './config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!onlineConfig) throw new Error('Online mode is not configured.');
  client ??= createClient(onlineConfig.url, onlineConfig.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
