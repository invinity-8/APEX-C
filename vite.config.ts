/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readBuildInfo } from './src/build/buildInfo';
import { APP_VERSION } from './src/build/version';

const build = readBuildInfo(process.env, APP_VERSION, new Date().toISOString());

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APEX_BUILD__: JSON.stringify(build) },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
