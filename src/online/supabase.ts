import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { onlineConfig } from './config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!onlineConfig) throw new Error('Online mode is not configured.');
  client ??= createClient(onlineConfig.url, onlineConfig.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}
