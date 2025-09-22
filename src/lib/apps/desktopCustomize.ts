import type { TDesktopCustomizeInput } from '@/lib/agentTools';

export type DesktopCustomizeRequest = TDesktopCustomizeInput;
export type DesktopCustomizeLayoutMutation = DesktopCustomizeRequest['layoutMutations'][number];
export type DesktopCustomizeThemeMutation = DesktopCustomizeRequest['themeMutations'][number];
export type DesktopCustomizeAsset = DesktopCustomizeRequest['assets'][number];

export type DesktopSnapshot = {
  id: string;
  hash?: string;
  createdAt: number;
};

export type DesktopTheme = {
  mode: 'image' | 'gradient';
  value: string;
  label?: string;
};

export type DesktopIconPosition = {
  left: number;
  top: number;
};

export type DesktopWindowGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DesktopCustomizeState = {
  version: number;
  updatedAt: string;
  theme: DesktopTheme;
  themeTokens: Record<string, string>;
  iconPositions: Record<string, DesktopIconPosition>;
  windowGeometries: Record<string, DesktopWindowGeometry>;
  windowTabs: Record<string, unknown>;
  appOrder: string[];
  metadata?: Record<string, unknown>;
};

export type DesktopStateAdapter = {
  load?: () => Promise<{ state: DesktopCustomizeState; hash?: string }>;
  validate?: (args: {
    state: DesktopCustomizeState;
    request: DesktopCustomizeRequest;
  }) => Promise<{ warnings?: string[]; blockers?: string[] }>;
  simulate?: (args: {
    state: DesktopCustomizeState;
    request: DesktopCustomizeRequest;
  }) => Promise<{ nextState: DesktopCustomizeState; warnings?: string[] }>;
  persist?: (args: {
    state: DesktopCustomizeState;
    request: DesktopCustomizeRequest;
    manifest: DesktopCustomizeManifest;
  }) => Promise<void>;
  snapshot?: (args: {
    state: DesktopCustomizeState;
    request: DesktopCustomizeRequest;
    reason: string;
  }) => Promise<DesktopSnapshot>;
};

export type DesktopCustomizeManifest = {
  requestId?: string;
  desktopId?: string;
  priorStateHash?: string;
  snapshotId?: string;
  appliedLayoutMutations: DesktopCustomizeLayoutMutation[];
  appliedThemeMutations: DesktopCustomizeThemeMutation[];
  assetPaths: string[];
  followUps: string[];
  warnings?: string[];
  blockers?: string[];
  createdAt: number;
  status: 'noop' | 'applied' | 'skipped';
};

export type DesktopCustomizeSuccess = {
  ok: true;
  manifest: DesktopCustomizeManifest;
};

export type DesktopCustomizeFailure = {
  ok: false;
  error: string;
  followUps?: string[];
  warnings?: string[];
};

export type DesktopCustomizeResult = DesktopCustomizeSuccess | DesktopCustomizeFailure;

export type DesktopCustomizeOptions = {
  input: DesktopCustomizeRequest;
  adapter?: DesktopStateAdapter;
  now?: () => number;
};

const DEFAULT_REASON = 'preflight-snapshot';

export async function performDesktopCustomize(options: DesktopCustomizeOptions): Promise<DesktopCustomizeResult> {
  const { input, adapter, now = () => Date.now() } = options;
  const metadata = input.metadata ?? {};
  const createdAt = now();

  try {
    const loadResult = adapter?.load ? await adapter.load() : { state: null, hash: metadata.priorStateHash };
    const currentState = loadResult?.state ?? null;
    const currentHash = loadResult?.hash ?? metadata.priorStateHash;

    const snapshot = adapter?.snapshot
      ? await adapter.snapshot({ state: currentState, request: input, reason: DEFAULT_REASON })
      : null;

    const validation = adapter?.validate ? await adapter.validate({ state: currentState, request: input }) : null;
    if (validation?.blockers && validation.blockers.length > 0) {
      return {
        ok: false,
        error: 'desktop_customize blocked by validation',
        followUps: input.followUps,
        warnings: validation.warnings,
      };
    }

    const simulation = adapter?.simulate
      ? await adapter.simulate({ state: currentState, request: input })
      : { nextState: currentState, warnings: undefined };

    const manifest: DesktopCustomizeManifest = {
      requestId: metadata.requestId,
      desktopId: metadata.desktopId,
      priorStateHash: currentHash ?? undefined,
      snapshotId: snapshot?.id ?? metadata.snapshotId,
      appliedLayoutMutations: input.layoutMutations ?? [],
      appliedThemeMutations: input.themeMutations ?? [],
      assetPaths: (input.assets ?? []).map((asset) => asset.path),
      followUps: input.followUps ?? [],
      warnings: validation?.warnings || simulation.warnings,
      createdAt,
      status: 'noop',
      blockers: undefined,
    };

    if (adapter?.persist) {
      await adapter.persist({ state: simulation.nextState, request: input, manifest });
      manifest.status = 'applied';
    }

    return { ok: true, manifest };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      followUps: input.followUps,
    };
  }
}
