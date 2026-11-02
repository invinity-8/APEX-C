import type { BuildInfo } from './buildInfo';
declare global {
  /** Injected by vite.config.ts at build time. */
  const __APEX_BUILD__: BuildInfo;
}
export {};
