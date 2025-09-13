import { useEffect, useRef } from 'react';
import { JSONSafe, stableHash, trimForChat } from '@/lib/agent/agentUtils';

type SpawnFn = (command: string, args?: string[], opts?: { cwd?: string }) => Promise<{ exitCode: number; output: string }>;

type Options = {
  spawn: SpawnFn;
  sendMessage: (content: string) => Promise<void>;
  getStatus: () => string;
};

export function useValidationDiagnostics({ spawn, sendMessage, getStatus }: Options) {
  const validateRunningRef = useRef(false);
  const lastErrorHashRef = useRef<string | null>(null);
  const autoPostBusyRef = useRef(false);

  async function autoPostDiagnostic(content: string) {
    if (autoPostBusyRef.current) return;
    autoPostBusyRef.current = true;
    try {
      await sendMessage(content);
    } finally {
      const release = () => {
        if (getStatus() === 'ready') {
          autoPostBusyRef.current = false;
        } else {
          setTimeout(release, 300);
        }
      };
      release();
    }
  }

  function extractBreakingESLint(jsonOutput: string): string | null {
    try {
      const reports: Array<{
        filePath: string;
        messages: Array<{ ruleId: string | null; fatal?: boolean; severity: number; message: string; line?: number; column?: number }>;
      }> = JSON.parse(jsonOutput);
      const breaking: string[] = [];
      for (const rep of reports) {
        for (const m of rep.messages) {
          const isParsing = m.fatal === true || m.ruleId === null || /Parsing error/i.test(m.message);
          if (isParsing) {
            breaking.push(`${rep.filePath}:${m.line ?? 0}:${m.column ?? 0} ${m.message}`);
          }
        }
      }
      if (breaking.length > 0) {
        const body = breaking.slice(0, 25).join('\n');
        return `Parsing errors detected (likely breaking):\n${trimForChat(body)}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  function extractBreakingTSErrors(tscOutput: string): string | null {
    const lines = tscOutput.split(/\r?\n/);
    const selected: string[] = [];
    const codeRe = /error\s+TS(\d+):\s*(.*)/i;
    for (const line of lines) {
      const m = line.match(codeRe);
      if (!m) continue;
      const code = parseInt(m[1], 10);
      const msg = m[2] || '';
      const isSyntax = code >= 1000 && code < 1200;
      const isModule = code === 2307;
      if (isSyntax || isModule) {
        selected.push(`TS${code}: ${msg}`);
      }
    }
    if (selected.length > 0) {
      return selected.slice(0, 25).join('\n');
    }
    return null;
  }

  async function runValidation(scope: 'quick' | 'full', changed: string[] = []) {
    if (validateRunningRef.current) return;
    validateRunningRef.current = true;
    try {
      const logs: string[] = [];
      try {
        const tsc = await spawn('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false']);
        if (tsc.exitCode !== 0) {
          const breakingTS = extractBreakingTSErrors(tsc.output);
          if (breakingTS) logs.push(`[TypeScript] ${breakingTS}`);
        }
      } catch (e) {
        logs.push(`[TypeScript] failed to run: ${e instanceof Error ? e.message : String(e)}`);
      }

      const lintTargets = changed.filter((p) => /\.(ts|tsx|js|jsx)$/.test(p));
      if (lintTargets.length > 0) {
        try {
          const eslint = await spawn('pnpm', [
            'exec',
            'eslint',
            '--format',
            'json',
            '--max-warnings=0',
            ...lintTargets,
          ]);
          if (eslint.exitCode !== 0) {
            const breakingLint = extractBreakingESLint(JSONSafe(eslint.output));
            if (breakingLint) logs.push(`[ESLint] ${breakingLint}`);
          }
        } catch (e) {
          logs.push(`[ESLint] failed to run: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const final = logs.filter(Boolean).join('\n\n');
      if (final.trim().length > 0) {
        const hash = stableHash(final);
        if (hash !== lastErrorHashRef.current) {
          lastErrorHashRef.current = hash;
          await autoPostDiagnostic(
            `Automatic validation detected issues after recent changes (${changed.join(', ')}). Please fix these errors:\n\n\`\`\`txt\n${final}\n\`\`\`\n`,
          );
        }
      }
    } finally {
      validateRunningRef.current = false;
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce?.detail?.source === 'preview') {
        const detail = ce.detail as any;
        const payload = detail?.content || detail?.description || '';
        if (payload) {
          const hash = stableHash(String(payload));
          if (hash !== lastErrorHashRef.current) {
            lastErrorHashRef.current = hash;
            void autoPostDiagnostic(
              `Preview runtime error detected automatically. Please diagnose and fix this error:\n\n\`\`\`txt\n${payload}\n\`\`\`\n`,
            );
          }
        }
      }
    };
    window.addEventListener('wc-preview-error', handler as EventListener);
    return () => window.removeEventListener('wc-preview-error', handler as EventListener);
  }, []);

  return { runValidation } as const;
}


