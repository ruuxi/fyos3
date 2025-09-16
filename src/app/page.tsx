"use client";

import WebContainer from '@/components/WebContainer';
import AIAgentBar from '@/components/AIAgentBar';
import { WebContainerProvider } from '@/components/WebContainerProvider';
import { ScreensProvider } from '@/components/ScreensProvider';
import { ScreenCarousel } from '@/components/ScreenCarousel';
import { AppStoreScreen } from '@/components/AppStoreScreen';
import { Authenticated, Unauthenticated } from 'convex/react';
import { SignInButton, UserButton } from '@clerk/nextjs';

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
          
          {/* Authentication UI - always visible across all screens */}
          <div className="absolute top-4 right-4 z-50">
            <Authenticated>
              <div className="flex items-center gap-3">
                <UserButton />
              </div>
            </Authenticated>
            <Unauthenticated>
              <SignInButton mode="modal">
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                  Sign In
                </button>
              </SignInButton>
            </Unauthenticated>
          </div>
          
          {/* AI Agent Bar - always visible across all screens */}
          <div className="absolute bottom-2 left-0 right-0 z-50">
            <AIAgentBar />
          </div>
        </main>
      </ScreensProvider>
    </WebContainerProvider>
  );
}
