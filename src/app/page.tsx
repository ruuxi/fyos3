"use client";

import WebContainer from '@/components/WebContainer';
import AIAgentBar from '@/components/AIAgentBar';
import { WebContainerProvider } from '@/components/WebContainerProvider';
import { ScreensProvider } from '@/components/ScreensProvider';
import { ScreenCarousel } from '@/components/ScreenCarousel';
import { AppStoreScreen } from '@/components/AppStoreScreen';
export default function Home() {
  return (
    <WebContainerProvider>
      <ScreensProvider defaultIndex={1} screenCount={2}>
        <main className="h-screen w-screen relative">
          <ScreenCarousel>
            {/* Screen 0: App Store */}
            <AppStoreScreen />
            
            {/* Screen 1: Desktop (default) */}
            <div className="relative h-full w-full">
              <WebContainer />
            </div>
          </ScreenCarousel>
          
          {/* AI Agent Bar - always visible across all screens */}
          <div className="absolute bottom-2 left-0 right-0 z-50">
            <AIAgentBar />
          </div>
        </main>
      </ScreensProvider>
    </WebContainerProvider>
  );
}
