'use client';

import type { ReactNode } from 'react';
import { WebContainerProvider } from '@/components/WebContainerProvider';
import WebContainer from '@/components/WebContainer';
import { BatchRunnerProvider } from './BatchRunnerContext';

function PersistentWebContainer() {
  return (
    <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
      <WebContainer />
    </div>
  );
}

export default function DevToolsProviders({ children }: { children: ReactNode }) {
  return (
    <WebContainerProvider>
      <BatchRunnerProvider>
        <PersistentWebContainer />
        {children}
      </BatchRunnerProvider>
    </WebContainerProvider>
  );
}
