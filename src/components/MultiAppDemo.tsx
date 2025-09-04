'use client';

import { useState, useEffect } from 'react';
import { useWebContainer } from './WebContainerProvider';
import WebContainer from './WebContainer';
import { ApplicationRouter } from '@/services/ApplicationRouter';
import { multiAppPersistence } from '@/utils/multi-app-persistence';

interface AppDefinition {
  appId: string;
  displayName: string;
  description: string;
  icon: string;
}

const DEMO_APPS: AppDefinition[] = [
  {
    appId: 'editor',
    displayName: 'Code Editor',
    description: 'VS Code-like editor in the browser',
    icon: '📝',
  },
  {
    appId: 'terminal',
    displayName: 'Terminal',
    description: 'Full terminal emulator',
    icon: '💻',
  },
  {
    appId: 'preview',
    displayName: 'Preview Server',
    description: 'Live preview of your application',
    icon: '🌐',
  },
  {
    appId: 'database',
    displayName: 'Database Explorer',
    description: 'Browse and edit database',
    icon: '🗄️',
  },
];

export default function MultiAppDemo() {
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const [appStates, setAppStates] = useState<Map<string, 'idle' | 'loading' | 'ready' | 'error'>>(new Map());
  const [metrics, setMetrics] = useState<any>(null);
  const [savedApps, setSavedApps] = useState<string[]>([]);
  const { orchestrator, getAppMetrics } = useWebContainer();

  // Create router
  const [router] = useState(() => new ApplicationRouter(orchestrator));

  // Register all demo apps
  useEffect(() => {
    DEMO_APPS.forEach(app => {
      router.registerApp(app.appId, app.displayName);
    });

    // Load saved apps list
    multiAppPersistence.listApps().then(apps => {
      setSavedApps(apps.map(a => a.appId));
    });
  }, [router]);

  // Update metrics periodically
  useEffect(() => {
    const updateMetrics = () => {
      setMetrics(orchestrator.getMetrics());
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 2000);
    return () => clearInterval(interval);
  }, [orchestrator]);

  const handleAppClick = async (appId: string) => {
    setActiveAppId(appId);
    setAppStates(prev => new Map(prev).set(appId, 'loading'));

    try {
      await router.navigateToApp(appId);
      setAppStates(prev => new Map(prev).set(appId, 'ready'));
    } catch (error) {
      console.error(`Failed to load app ${appId}:`, error);
      setAppStates(prev => new Map(prev).set(appId, 'error'));
    }
  };

  const handleSuspendApp = async (appId: string) => {
    await orchestrator.suspendApplication(appId);
    setAppStates(prev => new Map(prev).set(appId, 'idle'));
  };

  const handleTerminateApp = async (appId: string) => {
    await orchestrator.terminateApplication(appId);
    setAppStates(prev => new Map(prev).set(appId, 'idle'));
    if (activeAppId === appId) {
      setActiveAppId(null);
    }
  };

  const handleClearStorage = async (appId: string) => {
    await multiAppPersistence.deleteAppState(appId);
    setSavedApps(prev => prev.filter(id => id !== appId));
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <div className="w-80 bg-gray-800 p-4 overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Applications</h2>
        
        {/* App List */}
        <div className="space-y-2 mb-6">
          {DEMO_APPS.map(app => {
            const state = appStates.get(app.appId) || 'idle';
            const hasSavedData = savedApps.includes(app.appId);
            const container = orchestrator.getContainer(app.appId);
            const isActive = container?.state === 'active';
            const isSuspended = container?.state === 'suspended';
            
            return (
              <div
                key={app.appId}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  activeAppId === app.appId 
                    ? 'bg-blue-600' 
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
                onClick={() => handleAppClick(app.appId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{app.icon}</span>
                    <div>
                      <div className="font-semibold">{app.displayName}</div>
                      <div className="text-xs text-gray-400">{app.description}</div>
                      <div className="flex gap-2 mt-1">
                        {isActive && (
                          <span className="text-xs px-2 py-0.5 bg-green-600 rounded">Active</span>
                        )}
                        {isSuspended && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-600 rounded">Suspended</span>
                        )}
                        {hasSavedData && (
                          <span className="text-xs px-2 py-0.5 bg-purple-600 rounded">Saved</span>
                        )}
                        {state === 'loading' && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500 rounded">Loading...</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* App Controls */}
                {container && (
                  <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                    {isActive && (
                      <button
                        className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded"
                        onClick={() => handleSuspendApp(app.appId)}
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 rounded"
                      onClick={() => handleTerminateApp(app.appId)}
                    >
                      Terminate
                    </button>
                    {hasSavedData && (
                      <button
                        className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded"
                        onClick={() => handleClearStorage(app.appId)}
                      >
                        Clear Data
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* System Metrics */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="font-semibold mb-2">System Metrics</h3>
          {metrics && (
            <div className="space-y-1 text-sm">
              <div>Total Containers: {metrics.total}</div>
              <div>Active: {metrics.active}</div>
              <div>Suspended: {metrics.suspended}</div>
              <div>Memory Usage: {metrics.memoryUsageMB} MB</div>
              
              {/* Memory Bar */}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Memory</span>
                  <span>{metrics.memoryUsageMB} / 2048 MB</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-yellow-500 h-2 rounded-full transition-all"
                    style={{ width: `${(metrics.memoryUsageMB / 2048) * 100}%` }}
                  />
                </div>
              </div>

              {/* Container Limit */}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Containers</span>
                  <span>{metrics.total} / 10</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                    style={{ width: `${(metrics.total / 10) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Storage Info */}
        <div className="border-t border-gray-700 pt-4 mt-4">
          <h3 className="font-semibold mb-2">Storage</h3>
          <div className="text-sm">
            <div>Saved Apps: {savedApps.length}</div>
            <button
              className="mt-2 text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded"
              onClick={async () => {
                const deleted = await multiAppPersistence.pruneOldApps(7);
                console.log(`Pruned ${deleted} old apps`);
                const apps = await multiAppPersistence.listApps();
                setSavedApps(apps.map(a => a.appId));
              }}
            >
              Prune Old Apps (7+ days)
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {activeAppId ? (
          <WebContainer
            key={activeAppId}
            appId={activeAppId}
            displayName={DEMO_APPS.find(a => a.appId === activeAppId)?.displayName}
            className="flex-1"
            onReady={(container) => {
              console.log(`App ${activeAppId} is ready:`, container.metrics);
            }}
            onError={(error) => {
              console.error(`App ${activeAppId} error:`, error);
              setAppStates(prev => new Map(prev).set(activeAppId, 'error'));
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-3xl font-bold mb-4">Multi-Container Demo</h1>
              <p className="text-gray-400 mb-8">Select an application from the sidebar to get started</p>
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                {DEMO_APPS.map(app => (
                  <button
                    key={app.appId}
                    onClick={() => handleAppClick(app.appId)}
                    className="p-4 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <div className="text-3xl mb-2">{app.icon}</div>
                    <div className="font-semibold">{app.displayName}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}