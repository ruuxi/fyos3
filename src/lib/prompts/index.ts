import { ATTACHMENTS_PROMPT } from './addenda/attachments';
import { STYLING_PROMPT } from './addenda/styling';
import { UI_CHECKLIST_PROMPT } from './addenda/ui-checklist';
import { CREATE_INTENT_PROMPT } from './intents/create';
import { DESKTOP_INTENT_PROMPT } from './intents/desktop';
import { EDIT_INTENT_PROMPT } from './intents/edit';
import { MEDIA_INTENT_PROMPT } from './intents/media';
import { CLASSIFIER_PROMPT, DESKTOP_PREFLIGHT_PROMPT } from './classifier';
import { CAPABILITY_ROUTER_PROMPT } from './capabilityRouter';
import { PERSONA_PROMPT } from './persona';
import { BASE_PROMPT } from './system/base';
import { TOOL_SELECTION_PROMPT } from './system/tools-selection';
import { WEBCONTAINER_PROMPT } from './system/webcontainer';

export type SystemPromptIntent = 'create' | 'edit' | 'media' | 'desktop';

export interface BuildSystemPromptOptions {
  intent: SystemPromptIntent;
  hasAttachments?: boolean;
  includeStylingDetails?: boolean; // default true for create/edit
  installedApps?: string[];
}

export interface PromptSegment {
  id: string;
  content: string;
}

function collectIntentSegment(intent: SystemPromptIntent): PromptSegment {
  switch (intent) {
    case 'create':
      return { id: 'intent:create', content: CREATE_INTENT_PROMPT };
    case 'edit':
      return { id: 'intent:edit', content: EDIT_INTENT_PROMPT };
    case 'media':
      return { id: 'intent:media', content: MEDIA_INTENT_PROMPT };
    case 'desktop':
      return { id: 'intent:desktop', content: DESKTOP_INTENT_PROMPT };
    default:
      return { id: 'intent:edit', content: EDIT_INTENT_PROMPT };
  }
}

function createInstalledAppsSegment(installedApps: string[] | undefined): PromptSegment | null {
  if (!installedApps || installedApps.length === 0) {
    return null;
  }

  const trimmed = installedApps
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (trimmed.length === 0) {
    return null;
  }

  const MAX_APPS = 10;
  const limited = trimmed.slice(0, MAX_APPS);
  const hasOverflow = trimmed.length > MAX_APPS;

  const lines = limited.map((app) => `- ${app}`);
  if (hasOverflow) {
    lines.push('- …');
  }

  return {
    id: 'context:installed-apps',
    content: `## Current Apps Installed\n${lines.join('\n')}`,
  };
}

export function resolveSystemPromptSegments(options: BuildSystemPromptOptions): PromptSegment[] {
  const { intent, hasAttachments = false, includeStylingDetails, installedApps } = options;

  const segments: PromptSegment[] = [
    { id: 'system:base', content: BASE_PROMPT },
    { id: 'system:webcontainer', content: WEBCONTAINER_PROMPT },
    { id: 'system:tools', content: TOOL_SELECTION_PROMPT },
    collectIntentSegment(intent),
  ];

  const shouldIncludeStyling =
    includeStylingDetails ?? (intent === 'create' || intent === 'edit');

  if (intent === 'create' || intent === 'edit') {
    segments.push({ id: 'addenda:ui-checklist', content: UI_CHECKLIST_PROMPT });
  }

  if (shouldIncludeStyling) {
    segments.push({ id: 'addenda:styling', content: STYLING_PROMPT });
  }

  if (hasAttachments || intent === 'media') {
    segments.push({ id: 'addenda:attachments', content: ATTACHMENTS_PROMPT });
  }

  const installedAppsSegment = createInstalledAppsSegment(installedApps);
  if (installedAppsSegment) {
    segments.push(installedAppsSegment);
  }

  return segments;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  return resolveSystemPromptSegments(options)
    .map((segment) => segment.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');
}

/**
 * @deprecated Pending removal after prompt refactor rollout
 */
export const SYSTEM_PROMPT = buildSystemPrompt({
  intent: 'edit',
  hasAttachments: true,
  includeStylingDetails: true,
});

export { PERSONA_PROMPT, CLASSIFIER_PROMPT, DESKTOP_PREFLIGHT_PROMPT, CAPABILITY_ROUTER_PROMPT };
