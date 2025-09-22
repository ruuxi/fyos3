# Capability Routing & Persona Harmonization Plan

## Goal
- Guarantee factual/tool-capable responses for queries that require external data while preserving the unified Sim persona voice.
- Replace the brittle persona-versus-coder switchboard with a capability-aware router that consistently selects the correct execution path.

## Current Pain Points
- Binary classifier sends pure conversations to persona mode; follow-up factual requests stay trapped there.
- Tool routing only considers create/edit/media/desktop; no bucket for information lookups.
- Persona voice is tied to the classifier outcome instead of being a post-processing layer.

## Proposed Architecture
1. **Capability Router**
   - Input: last user message + attachment hints.
   - Output (enum): `banter`, `factual_lookup`, `build_edit`, `media`, `desktop`.
   - Implementation: small prompt classifier or distilled local model that explicitly detects numerical/factual/location/time questions.
2. **Intent Resolution**
   - Map `build_edit` → existing builder (create/edit heuristics).
   - Map `media`, `desktop` → current specialized flows.
   - Map `factual_lookup` → force agent pipeline with a constrained tool palette (`web_search`, future `weather`, etc.).
   - Map `banter` → persona chat with no tools.
3. **Persona Layer**
   - Remove binary persona/coder classification.
   - Always pipe final assistant text through a persona post-processor (prompt template) that wraps the response in Sim's tone regardless of intent.
4. **Tool Scheduling**
   - For `factual_lookup`, auto-seed a first tool call plan (e.g., generate search queries) to reduce latency.
   - Keep existing tool subsetting for other intents.

## Implementation Steps
1. **Classifier Design**
   - Draft prompt with enumerated intent labels and example pairs.
   - Add unit tests covering ambiguous phrasing (e.g., "what's the weather" vs. "make a weather app").
2. **Server Routing Changes**
   - Replace current persona toggle with capability router output.
   - Expand `deriveAgentIntent` to honor new `factual_lookup` bucket.
   - Force agent mode + lookup toolset when router says `factual_lookup`.
3. **Persona Post-Processing**
   - Introduce `applyPersonaVoice(text, intent)` helper that wraps completions in Sim's tone.
   - Ensure persona layer is skipped for tool result messages to avoid corrupting structured JSON.
4. **Client Hinting**
   - Mirror capability router logic in `useAgentChat` for optimistic intent hints (keywords like "temperature", "time", "convert", "define").
5. **Tool Palette Updates**
   - Define a minimal lookup tool bundle; add weather/clock adapters if available.
   - Gate search execution behind capability router to prevent persona loops.
6. **Metrics & Logging**
   - Emit router decision, downstream intent, and toolset used per session.
   - Track persona post-processor invocations for QA.
7. **QA & Rollout**
   - Craft test transcripts covering banter, weather, coding, desktop, media.
   - Ship behind feature flag; fall back to legacy behavior on regression.

## Acceptance Criteria
- Lookup-style questions never respond with persona-only banter; they include retrieved data or a clear failure reason.
- All responses, regardless of tool usage, maintain consistent Sim persona tone.
- No regression in existing create/edit/media/desktop routing.
- Logging confirms router selections match expected buckets on integration tests.

## Rollback Strategy
- Feature flag to disable capability router and revert to current binary classifier + persona gating.
- Old routing code remains intact for one release cycle.
