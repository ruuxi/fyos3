// Dev-only metrics configuration and pricing constants
// Enabled if NODE_ENV !== 'production' OR AGENT_METRICS=1

export const metricsEnabled: boolean =
  process.env.NODE_ENV !== 'production' || process.env.AGENT_METRICS === '1';

// Global token pricing (USD per 1M tokens)
export const PRICING = {
  inputPerMillion: 1.25,
  outputPerMillion: 10.0,
} as const;

// Default attribution strategy label (single mode)
export type AttributionStrategy = 'payloadWeighted';

export const defaultAttributionStrategy: AttributionStrategy = 'payloadWeighted';

// Session store limits
export const SESSION_LIMITS = {
  // Maximum events kept per session (ring buffer)
  maxEventsPerSession: 5000,
  // Maximum number of recent sessions in summaries
  maxRecentSessions: 200,
} as const;
