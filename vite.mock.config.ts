/**
 * LOCAL TEST HARNESS: `npm run dev:mock` runs the online client against a mocked Supabase
 * (see dev/mockSupabase.ts). Never used for production builds.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import { mockSupabase } from './dev/mockSupabase';

process.env.VITE_SUPABASE_URL = 'http://localhost:5174';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'mock-publishable-key';

export default mergeConfig(base, defineConfig({ plugins: [mockSupabase()], server: { port: 5174, strictPort: true } }));
