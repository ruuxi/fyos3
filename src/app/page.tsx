import WebContainer from '@/components/WebContainer';
import AIAgentBar from '@/components/AIAgentBar';
import { WebContainerProvider } from '@/components/WebContainerProvider';

export default function Home() {
  return (
    <WebContainerProvider>
      <main className="h-screen w-screen relative">
        <WebContainer />
        <div className="absolute bottom-4 left-0 right-0 z-10">
          <AIAgentBar />
        </div>
      </main>
    </WebContainerProvider>
  );
}
