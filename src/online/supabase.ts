import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { onlineConfig } from './config';

/** Captured before supabase-js consumes the URL hash: was this an invite or password-recovery link? */
export const authLinkType: string | null = (() => {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    return hash.get('type') ?? query.get('type');
  } catch {
    return null;
  }
})();

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!onlineConfig) throw new Error('Online mode is not configured.');
  client ??= createClient(onlineConfig.url, onlineConfig.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}
