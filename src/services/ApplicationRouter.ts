import { WebContainerOrchestrator, ContainerInstance } from './WebContainerOrchestrator';

export interface AppRoute {
  appId: string;
  displayName: string;
  path: string; // URL path segment (e.g., /app/editor)
  serverUrl?: string; // WebContainer server URL when active
  state: 'active' | 'suspended' | 'loading' | 'error';
}

export interface RouteConfig {
  basePath?: string; // Base path for all apps (default: /apps)
  defaultApp?: string; // Default app to load
}

export class ApplicationRouter {
  private routes = new Map<string, AppRoute>();
  private basePath: string;
  private defaultApp?: string;
  private orchestrator: WebContainerOrchestrator;

  constructor(orchestrator: WebContainerOrchestrator, config?: RouteConfig) {
    this.orchestrator = orchestrator;
    this.basePath = config?.basePath || '/apps';
    this.defaultApp = config?.defaultApp;
    
    // Listen for container events
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.orchestrator.on('container-created', (appId: string) => {
      this.updateRouteState(appId, 'loading');
    });

    this.orchestrator.on('container-suspended', (appId: string) => {
      this.updateRouteState(appId, 'suspended');
    });

    this.orchestrator.on('container-error', ({ appId }: { appId: string }) => {
      this.updateRouteState(appId, 'error');
    });

    this.orchestrator.on('container-terminated', (appId: string) => {
      this.routes.delete(appId);
    });
  }

  /**
   * Register an application route
   */
  registerApp(appId: string, displayName: string, path?: string): AppRoute {
    const appPath = path || `${this.basePath}/${appId}`;
    
    const route: AppRoute = {
      appId,
      displayName,
      path: appPath,
      state: 'suspended',
    };

    this.routes.set(appId, route);
    
    // Check if container exists and update state
    const container = this.orchestrator.getContainer(appId);
    if (container) {
      this.updateFromContainer(container);
    }

    return route;
  }

  /**
   * Get route for an application
   */
  getRoute(appId: string): AppRoute | undefined {
    return this.routes.get(appId);
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): AppRoute[] {
    return Array.from(this.routes.values());
  }

  /**
   * Get active routes (containers that are running)
   */
  getActiveRoutes(): AppRoute[] {
    return this.getAllRoutes().filter(route => route.state === 'active');
  }

  /**
   * Parse URL path to determine which app to load
   */
  parseUrl(pathname: string): { appId: string | null; subPath: string } {
    // Remove trailing slash
    const cleanPath = pathname.replace(/\/$/, '');
    
    // Check if path starts with base path
    if (!cleanPath.startsWith(this.basePath)) {
      return { appId: this.defaultApp || null, subPath: cleanPath };
    }

    // Extract app ID from path
    const pathSegments = cleanPath.slice(this.basePath.length).split('/').filter(Boolean);
    
    if (pathSegments.length === 0) {
      return { appId: this.defaultApp || null, subPath: '/' };
    }

    const appId = pathSegments[0];
    const subPath = '/' + pathSegments.slice(1).join('/');

    return { appId, subPath };
  }

  /**
   * Generate URL for an application
   */
  generateUrl(appId: string, subPath?: string): string {
    const route = this.routes.get(appId);
    if (!route) {
      return `${this.basePath}/${appId}${subPath || ''}`;
    }
    return `${route.path}${subPath || ''}`;
  }

  /**
   * Navigate to an application (returns container instance)
   */
  async navigateToApp(appId: string): Promise<ContainerInstance | null> {
    // Check if app is registered
    const route = this.routes.get(appId);
    if (!route) {
      console.warn(`[Router] App ${appId} is not registered`);
      return null;
    }

    // Get or create container
    let container = this.orchestrator.getContainer(appId);
    
    if (!container) {
      // Create new container
      container = await this.orchestrator.createApplication({
        appId,
        displayName: route.displayName,
        autoSuspend: true,
        suspendAfterMs: 5 * 60 * 1000,
      });
    } else if (container.state === 'suspended') {
      // Resume suspended container
      await container.resume();
    }

    // Update route with container info
    this.updateFromContainer(container);

    return container;
  }

  /**
   * Update route state from container
   */
  private updateFromContainer(container: ContainerInstance): void {
    const route = this.routes.get(container.appId);
    if (!route) return;

    route.serverUrl = container.serverUrl;
    
    switch (container.state) {
      case 'active':
        route.state = 'active';
        break;
      case 'suspended':
        route.state = 'suspended';
        break;
      case 'error':
        route.state = 'error';
        break;
      default:
        route.state = 'loading';
    }
  }

  /**
   * Update route state
   */
  private updateRouteState(appId: string, state: AppRoute['state']): void {
    const route = this.routes.get(appId);
    if (route) {
      route.state = state;
    }
  }

  /**
   * Get application server URL (for iframe src)
   */
  getAppServerUrl(appId: string): string | undefined {
    const container = this.orchestrator.getContainer(appId);
    return container?.serverUrl;
  }

  /**
   * Preload an application (boot container but don't navigate)
   */
  async preloadApp(appId: string, displayName?: string): Promise<void> {
    // Register route if not exists
    if (!this.routes.has(appId)) {
      this.registerApp(appId, displayName || appId);
    }

    // Create container in background
    const container = await this.orchestrator.createApplication({
      appId,
      displayName: displayName || appId,
      autoSuspend: true,
      suspendAfterMs: 10 * 60 * 1000, // Longer timeout for preloaded apps
    });

    this.updateFromContainer(container);
  }

  /**
   * Get routing statistics
   */
  getStats(): {
    totalApps: number;
    activeApps: number;
    suspendedApps: number;
    memoryUsageMB: number;
  } {
    const metrics = this.orchestrator.getMetrics();
    
    return {
      totalApps: this.routes.size,
      activeApps: metrics.active,
      suspendedApps: metrics.suspended,
      memoryUsageMB: metrics.memoryUsageMB,
    };
  }
}

// Hook for React components
export function createRouterHooks(router: ApplicationRouter) {
  return {
    useAppNavigation: () => {
      return {
        navigateToApp: (appId: string) => router.navigateToApp(appId),
        getAppUrl: (appId: string, subPath?: string) => router.generateUrl(appId, subPath),
        parseCurrentUrl: () => router.parseUrl(window.location.pathname),
        getAllApps: () => router.getAllRoutes(),
        getActiveApps: () => router.getActiveRoutes(),
      };
    },

    useAppRoute: (appId: string) => {
      return {
        route: router.getRoute(appId),
        serverUrl: router.getAppServerUrl(appId),
        navigate: () => router.navigateToApp(appId),
      };
    },
  };
}

// Singleton router instance
let routerInstance: ApplicationRouter | null = null;

export function getApplicationRouter(orchestrator: WebContainerOrchestrator): ApplicationRouter {
  if (!routerInstance) {
    routerInstance = new ApplicationRouter(orchestrator);
  }
  return routerInstance;
}

export function resetApplicationRouter(): void {
  routerInstance = null;
}