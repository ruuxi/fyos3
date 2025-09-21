import type { ReactNode } from 'react';
import DevToolsProviders from '@/components/dev-tools/DevToolsProviders';

export default function DevToolsLayout({ children }: { children: ReactNode }) {
  return <DevToolsProviders>{children}</DevToolsProviders>;
}
