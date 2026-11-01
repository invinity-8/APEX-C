import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import { demoAllowed, onlineConfig } from './online/config';
import { useDemoGame } from './state/useGame';
import './index.css';

// The online client (Supabase SDK, auth screens) is only downloaded when it is used.
const OnlineRoot = lazy(() => import('./online/OnlineRoot').then((m) => ({ default: m.OnlineRoot })));

/**
 * Mode selection:
 *  - Online mode (default when VITE_SUPABASE_URL + publishable key are configured): login required.
 *  - Demo mode: local-only sandbox. Used when online mode is not configured, or via ?demo
 *    when demo access is allowed (development, or VITE_APEX_ALLOW_DEMO=true).
 *    The demo never reads or writes the shared campaign, so it cannot bypass authentication.
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
const useDemo = !onlineConfig || (wantsDemo && demoAllowed);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useDemo ? (
      <DemoApp />
    ) : (
      <Suspense fallback={<Loading />}>
        <OnlineRoot />
      </Suspense>
    )}
    <SpeedInsights />
  </StrictMode>,
);
