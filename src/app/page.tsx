"use client";

import WebContainer from '@/components/WebContainer';
import AIAgentBar from '@/components/AIAgentBar';
import { WebContainerProvider } from '@/components/WebContainerProvider';
import { Authenticated, Unauthenticated, useQuery } from 'convex/react';
import { SignInButton, UserButton } from '@clerk/nextjs';
import { api } from '../../convex/_generated/api';

export default function Home() {
  return (
    <WebContainerProvider>
      <main className="h-screen w-screen relative">
        <WebContainer />
        <div className="absolute top-4 right-4 z-10">
          <Authenticated>
            <div className="flex items-center gap-3">
              <UserButton />
            </div>
          </Authenticated>
          <Unauthenticated>
            <SignInButton />
          </Unauthenticated>
        </div>
        <div className="absolute bottom-2 left-0 right-0 z-10">
          <AIAgentBar />
        </div>
      </main>
    </WebContainerProvider>
  );
}