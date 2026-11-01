import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { OfflineEntry } from './entry/OfflineEntry';
import { demoAllowed, missingConfig, onlineConfig } from './online/config';
import { useDemoGame } from './state/useGame';
import './index.css';

// The online client (Supabase SDK, login screens) is only downloaded when it is used.
const OnlineRoot = lazy(() => import('./online/OnlineRoot').then((m) => ({ default: m.OnlineRoot })));

/**
 * Mode selection – there is NO silent fallback to a local game:
 *  - /?demo with demo allowed (development, or VITE_APEX_ALLOW_DEMO=true) → local demo, clearly labelled
 *  - online configuration present → online mode, login required, shared Supabase campaign
 *  - no configuration → welcome screen; "Join Campaign" shows a setup error (no game)
 */
function DemoApp() {
  const game = useDemoGame();
  return <App game={game} />;
}

function Loading() {
  return (
    <div className="auth-bg flex h-full items-center justify-center text-sm text-marble-300" role="status">
      Opening the gates…
    </div>
  );
}

const wantsDemo = new URLSearchParams(window.location.search).has('demo');
let root;
if (wantsDemo && demoAllowed) root = <DemoApp />;
else if (onlineConfig)
  root = (
    <Suspense fallback={<Loading />}>
      <OnlineRoot />
    </Suspense>
  );
else root = <OfflineEntry missing={missingConfig} />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {root}
    <SpeedInsights />
  </StrictMode>,
);
