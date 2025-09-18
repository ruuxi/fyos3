import { MetricEvent } from '@/lib/metrics/types';

export type MetricsSubscriber = (event: MetricEvent) => void;

class MetricsBus {
  private subscribersAll: Set<MetricsSubscriber> = new Set();
  private subscribersBySession: Map<string, Set<MetricsSubscriber>> = new Map();

  publish(event: MetricEvent) {
    // Notify global subscribers
    for (const fn of this.subscribersAll) {
      try { fn(event); } catch {}
    }
    // Notify session-specific subscribers
    const set = this.subscribersBySession.get(event.sessionId);
    if (set) {
      for (const fn of set) {
        try { fn(event); } catch {}
      }
    }
  }

  subscribe(sub: MetricsSubscriber): () => void {
    this.subscribersAll.add(sub);
    return () => { this.subscribersAll.delete(sub); };
  }

  subscribeToSession(sessionId: string, sub: MetricsSubscriber): () => void {
    if (!this.subscribersBySession.has(sessionId)) this.subscribersBySession.set(sessionId, new Set());
    const set = this.subscribersBySession.get(sessionId)!;
    set.add(sub);
    return () => {
      const s = this.subscribersBySession.get(sessionId);
      if (s) {
        s.delete(sub);
        if (s.size === 0) this.subscribersBySession.delete(sessionId);
      }
    };
  }
}

// Ensure a single bus instance across route bundles / HMR
declare global {
  // eslint-disable-next-line no-var
  var __FYOS_METRICS_BUS__: MetricsBus | undefined;
}

export const metricsBus: MetricsBus =
  globalThis.__FYOS_METRICS_BUS__ ?? (globalThis.__FYOS_METRICS_BUS__ = new MetricsBus());
