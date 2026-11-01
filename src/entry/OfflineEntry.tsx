/** Entry flow for deployments WITHOUT online configuration: welcome screen, then a clear setup error. */
import { useState } from 'react';
import { NotConnectedScreen, WelcomeScreen } from './EntryScreens';

export function OfflineEntry({ missing }: { missing: string[] }) {
  const [step, setStep] = useState<'welcome' | 'error'>('welcome');
  if (step === 'welcome') return <WelcomeScreen onJoin={() => setStep('error')} />;
  return (
    <>
      <NotConnectedScreen missing={missing} onBack={() => setStep('welcome')} />
      {import.meta.env.DEV && (
        <p className="fixed bottom-3 left-1/2 -translate-x-1/2 text-xs text-marble-500">
          Development: open the <a className="text-gold-300 underline" href="/?demo">local demo</a> instead.
        </p>
      )}
    </>
  );
}
