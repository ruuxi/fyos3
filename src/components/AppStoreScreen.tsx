'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Download, Star, TrendingUp, Sparkles, Upload } from 'lucide-react';
import { useWebContainer } from './WebContainerProvider';

type AppRecord = {
  _id: string;
  appId: string;
  name: string;
  icon?: string;
  description?: string;
  tags?: string[];
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export function AppStoreScreen() {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [localApps, setLocalApps] = useState<Array<{id: string; name: string; icon?: string; path: string}>>([]);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const { instance } = useWebContainer();

  useEffect(() => {
    let mounted = true;
    
    const loadApps = async () => {
      try {
        const data = await fetchJSON<{ apps: AppRecord[] }>('/api/store/apps');
        if (!mounted) return;
        setApps(data.apps || []);
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : 'Failed to load apps';
        setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadApps();
    return () => { mounted = false; };
  }, []);

  // Load local apps from the WebContainer registry
  useEffect(() => {
    if (!instance) return;
    
    let mounted = true;
    const loadLocalApps = async () => {
      try {
        const registryContent = await instance.fs.readFile('/public/apps/registry.json', 'utf8');
        const registry = JSON.parse(registryContent as string);
        if (mounted) {
          setLocalApps(Array.isArray(registry) ? registry : []);
        }
      } catch (e) {
        console.warn('Failed to load local apps registry:', e);
        if (mounted) {
          setLocalApps([]);
        }
      }
    };

    loadLocalApps();
    return () => { mounted = false; };
  }, [instance]);

  const handleInstall = async (appId: string) => {
    if (installingIds.has(appId) || !instance) return;

    setInstallingIds(prev => new Set(prev).add(appId));
    
    try {
      const res = await fetch(`/api/store/apps/${appId}/bundle`);
      if (!res.ok) throw new Error('Bundle fetch failed');
      
      const buf = new Uint8Array(await res.arrayBuffer());
      const { installAppFromBundle } = await import('@/utils/app-install');
      await installAppFromBundle(instance, buf);
    } catch (e) {
      console.error('Install failed:', e);
    } finally {
      setInstallingIds(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const handlePublish = async (localApp: {id: string; name: string; icon?: string; path: string}) => {
    if (publishingIds.has(localApp.id) || !instance) return;

    setPublishingIds(prev => new Set(prev).add(localApp.id));
    
    try {
      const { buildAppTarGz } = await import('@/utils/app-packaging');
      
      // Create manifest for the app
      const manifest = {
        schemaVersion: 1 as const,
        id: localApp.id,
        name: localApp.name,
        icon: localApp.icon || '📦',
        entry: localApp.path,
        dependencies: {},
        description: `Published from desktop: ${localApp.name}`,
        tags: ['user-created'],
      };

      // Build the package
      const pkg = await buildAppTarGz(instance, localApp.id, manifest);
      const blobBase64 = btoa(String.fromCharCode(...pkg.tarGz));

      // Publish to store
      const res = await fetch('/api/publish/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: localApp.id,
          name: localApp.name,
          version: '1.0.0',
          description: manifest.description,
          icon: manifest.icon,
          tags: manifest.tags,
          size: pkg.size,
          manifestHash: pkg.manifestHash,
          depsHash: pkg.depsHash,
          blobBase64,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Publish failed: ${errorText}`);
      }

      // Refresh the apps list to show the newly published app
      const data = await fetchJSON<{ apps: AppRecord[] }>('/api/store/apps');
      setApps(data.apps || []);
      
    } catch (e) {
      console.error('Publish failed:', e);
      alert(`Failed to publish ${localApp.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev);
        next.delete(localApp.id);
        return next;
      });
    }
  };

  // Group apps for different sections
  const featuredApps = apps.slice(0, 3);
  const newApps = apps.slice(3, 8);
  const popularApps = apps.slice(0, 6);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(225deg, #0b1020 0%, #1e2760 60%, #462e7e 100%)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-300">Loading App Store...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(225deg, #0b1020 0%, #1e2760 60%, #462e7e 100%)' }}>
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load App Store</p>
          <p className="text-slate-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'linear-gradient(225deg, #0b1020 0%, #1e2760 60%, #462e7e 100%)' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/10 backdrop-blur-xl border-b border-white/20">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">App Store</h1>
              <p className="text-white/70 text-sm">Discover amazing apps for your desktop</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2 border-white/30 text-white hover:bg-white/10">
              <Search className="w-4 h-4" />
              Search
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs defaultValue="discover" className="space-y-8">
          <TabsList className="grid w-full grid-cols-4 max-w-lg bg-white/10 border-white/20">
            <TabsTrigger value="discover" className="gap-2 text-white/70 data-[state=active]:text-white data-[state=active]:bg-white/20">
              <Sparkles className="w-4 h-4" />
              Discover
            </TabsTrigger>
            <TabsTrigger value="apps" className="gap-2 text-white/70 data-[state=active]:text-white data-[state=active]:bg-white/20">
              <Download className="w-4 h-4" />
              Apps
            </TabsTrigger>
            <TabsTrigger value="trending" className="gap-2 text-white/70 data-[state=active]:text-white data-[state=active]:bg-white/20">
              <TrendingUp className="w-4 h-4" />
              Trending
            </TabsTrigger>
            <TabsTrigger value="publish" className="gap-2 text-white/70 data-[state=active]:text-white data-[state=active]:bg-white/20">
              <Upload className="w-4 h-4" />
              Publish
            </TabsTrigger>
          </TabsList>

          <TabsContent value="discover" className="space-y-12">
            {/* Hero Section */}
            {featuredApps.length > 0 && (
              <section>
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 p-8 text-white">
                  <div className="relative z-10">
                    <Badge className="mb-4 bg-white/20 text-white border-white/30">
                      Editor&apos;s Choice
                    </Badge>
                    <h2 className="text-4xl font-bold mb-2">{featuredApps[0].name}</h2>
                    <p className="text-lg opacity-90 mb-6 max-w-md">
                      {featuredApps[0].description || 'Discover this amazing app'}
                    </p>
                    <Button
                      size="lg"
                      className="bg-white text-slate-900 hover:bg-white/90"
                      onClick={() => handleInstall(featuredApps[0]._id)}
                      disabled={installingIds.has(featuredApps[0]._id)}
                    >
                      {installingIds.has(featuredApps[0]._id) ? 'Installing...' : 'Get'}
                    </Button>
                  </div>
                  <div className="absolute -right-8 -top-8 text-8xl opacity-20">
                    {featuredApps[0].icon || '📦'}
                  </div>
                </div>
              </section>
            )}

            {/* New & Noteworthy */}
            {newApps.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-bold text-white">New & Noteworthy</h3>
                  <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10">See All</Button>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  {newApps.map((app) => (
                    <Card key={app._id} className="flex-shrink-0 w-72 hover:shadow-lg transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-2xl">
                            {app.icon || '📦'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-lg truncate">{app.name}</CardTitle>
                            <CardDescription className="line-clamp-2">
                              {app.description || 'A great app for your desktop'}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                            ))}
                            <span className="text-sm text-slate-600 ml-2">4.8</span>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleInstall(app._id)}
                            disabled={installingIds.has(app._id)}
                          >
                            {installingIds.has(app._id) ? 'Installing...' : 'Get'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="apps" className="space-y-8">
            <section>
              <h3 className="text-2xl font-bold text-white mb-6">All Apps</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {apps.map((app) => (
                  <Card key={app._id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-3xl">
                          {app.icon || '📦'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-xl">{app.name}</CardTitle>
                          <CardDescription className="line-clamp-2">
                            {app.description || 'A great app for your desktop'}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1">
                          {app.tags?.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <Button
                          onClick={() => handleInstall(app._id)}
                          disabled={installingIds.has(app._id)}
                        >
                          {installingIds.has(app._id) ? 'Installing...' : 'Get'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="trending" className="space-y-8">
            <section>
              <h3 className="text-2xl font-bold text-white mb-6">Trending Now</h3>
              <div className="space-y-4">
                {popularApps.map((app, index) => (
                  <Card key={app._id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-center gap-4">
                        <div className="text-2xl font-bold text-slate-400 w-8">
                          {index + 1}
                        </div>
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-2xl">
                          {app.icon || '📦'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-lg">{app.name}</h4>
                          <p className="text-slate-600 text-sm line-clamp-1">
                            {app.description || 'A great app for your desktop'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleInstall(app._id)}
                            disabled={installingIds.has(app._id)}
                          >
                            {installingIds.has(app._id) ? 'Installing...' : 'Get'}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="publish" className="space-y-8">
            <section>
              <h3 className="text-2xl font-bold text-white mb-6">Publish Your Apps</h3>
              <p className="text-white/70 mb-6">Share your locally created apps with the community by publishing them to the App Store.</p>
              
              {localApps.length === 0 ? (
                <Card className="bg-white/5 border-white/20">
                  <CardContent className="p-8 text-center">
                    <Upload className="w-12 h-12 text-white/40 mx-auto mb-4" />
                    <h4 className="text-lg font-semibold text-white mb-2">No Local Apps Found</h4>
                    <p className="text-white/60 mb-4">
                      Create apps using the AI agent first, then come back here to publish them.
                    </p>
                    <p className="text-white/50 text-sm">
                      Try saying: &quot;Create a calculator app&quot; or &quot;Build a todo list app&quot;
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {localApps.map((app) => (
                    <Card key={app.id} className="hover:shadow-lg transition-shadow bg-white/5 border-white/20">
                      <CardHeader>
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-3xl">
                            {app.icon || '📦'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-xl text-white">{app.name}</CardTitle>
                            <CardDescription className="text-white/60">
                              Local app • Ready to publish
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="bg-white/10 text-white/80 border-white/20">
                            {app.id}
                          </Badge>
                          <Button
                            onClick={() => handlePublish(app)}
                            disabled={publishingIds.has(app.id)}
                            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                          >
                            {publishingIds.has(app.id) ? 'Publishing...' : 'Publish'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
