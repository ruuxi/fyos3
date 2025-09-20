# WC Boot Mount Changes

## Summary
- Expose the WebContainer instance immediately after snapshot mount while dependency installs continue in the background.
- Track a shared `depsReady` flag and provide a `waitForDepsReady` helper so exec-like tools only run once installs succeed.
- Extend the tool scheduler’s safe set so `web_fs_*`, `app_manage`, and `submit_plan` proceed without waiting on installs.
- Update the agent prompt to steer early runs toward safe filesystem tools.

## Files Touched
- `src/components/WebContainerProvider.tsx`
- `src/components/WebContainer.tsx`
- `src/components/AIAgentBar.tsx`
- `src/components/agent/AIAgentBar/hooks/useAgentChat.ts`
- `src/components/agent/AIAgentBar/hooks/useAgentController.ts`
- `src/lib/prompts.ts`

## Latency Expectations
- Safe tools (filesystem ops, plan submission, app creation) can run as soon as the snapshot mounts—no longer blocked behind `pnpm install`.
- Exec-heavy tools (`web_exec`, `validate_project`) automatically queue until dependencies are installed, preventing duplicate install attempts and reducing retry chatter.
- Overall agent response should feel quicker during cold boot because planning and file scaffolding start immediately.

## Token Cost Hypothesis
- Fewer blocked tool calls and retries shrink the conversational back-and-forth required to handle dependency waits.
- Earlier filesystem access should reduce unnecessary “waiting for install” advisories sent to the model, lowering token usage across multi-step runs.

## Verification Notes
- Run `pnpm run verify:webcontainer` after ensuring the snapshot artifacts (e.g., `src/data/webcontainer-files.ts`) exist; the command currently fails if the snapshot has not been regenerated.
