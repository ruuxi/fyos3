### Research: Custom Diff / AST-Match Editing Tool for FYOS Agent

#### Goal
- Add a robust code-edit tool the agent can call to modify files using contextual diff and/or AST-aware matching, with verification and safe fallbacks.

#### Integration Surface in FYOS
- **Client tool runner**: `src/components/AIAgentBar.tsx` handles tool execution for file ops. The new tool should run here to access WebContainer FS.
- **Server tool declaration**: `src/app/api/agent/route.ts` exposes tools to the model (Zod schemas in `@/lib/agentTools`). Add a new tool, e.g., `apply_structured_edits`.
- **Validation**: Reuse `validate_project` (TypeScript noEmit + ESLint on changed files; optional build) after edits for safety.
- **Observability**: Log tool calls and timings via `agentLogger` (already integrated in the server route).

---

### Candidate Approaches

#### 1) Contextual Text Diff (Unified diff or diff-match-patch)
- **How it works**: Agent supplies either a unified diff or a tuple of {before_snippet, after_snippet, anchors}. We compute a fuzzy location using context lines and apply text edits.
- **Implementation options**:
  - Google diff-match-patch (DMP) for fuzzy matching and patch apply.
  - Unified diff parser + "approximate hunk matching" (tolerant to whitespace/nearby changes).
- **Pros**:
  - Small dependency footprint; language-agnostic; fast (<5 ms for typical files).
  - Easy to implement first; great fallback.
- **Cons**:
  - Brittle under code motion/formatting changes; not semantics-aware.
  - Hard to guarantee idempotence when the code drifts.
- **Performance**: O(n) for scan + matching; unified diff apply is typically sub-10 ms on <200 KB files. Worst-case backtracking can degrade on highly repetitive text.

#### 2) AST Edits for TS/TSX/JS (TypeScript Compiler API or Babel/Recast)
- **How it works**: Parse file to AST, locate nodes via selectors, transform, then print preserving formatting/comments.
- **Implementation options**:
  - TypeScript Compiler API via `ts-morph` for robust TS/TSX handling (symbols, type info if needed).
  - `@babel/parser` + `recast` for parsing TS/TSX and pretty-printing while preserving comments.
- **Pros**:
  - Semantics-aware; robust to formatting; precise node targeting.
  - Can ensure import de-duplication, named imports, prop rename, etc.
- **Cons**:
  - Larger deps (Babel/Recast ~ hundreds of KB; ts-morph + TS ~ MBs). Cold parse ~50–300 ms/file.
  - Printing can rewrite stylistic details if not carefully configured.
- **Performance**:
  - `@babel/parser` parse: ~30–120 ms for 200–400 KB TSX; recast print: ~20–80 ms.
  - `ts-morph` cold start: 150–400 ms (includes TypeScript init); warm edits much faster.

#### 3) Tree-sitter Structural Queries (Multi-language)
- **How it works**: Use WASM tree-sitter parsers (TS, TSX, JS, JSON, CSS, etc.). Match nodes via tree-sitter query language, then splice text ranges with minimal edits.
- **Pros**:
  - Fast, incremental parsing; smallish per-grammar WASM. Language-agnostic with consistent query semantics.
  - Precise node ranges; keeps original formatting by splicing text instead of re-printing full file.
- **Cons**:
  - Requires bundling grammars; writing correct queries is non-trivial.
  - No automatic pretty-printing; responsibility on templates/splicing.
- **Performance**:
  - Parse 100–300 KB in ~10–40 ms; query in ~1–5 ms; minimal string splice.

#### 4) Structural Search/Replace (Comby-like)
- **How it works**: Use structural patterns with holes (e.g., `foo(:[args])`) to match syntax, then replace using templates. Works across many languages with minimal parsers.
- **Pros**:
  - Low complexity; language-agnostic; easier than AST for many refactors.
- **Cons**:
  - Not as precise as full AST; can misfire on edge cases.
- **Performance**:
  - Linear in file size; typically sub-20 ms for moderate files.

#### 5) LSP-backed Edits (TypeScript Language Service)
- **How it works**: Spin up TS language service (in-browser or in WebContainer via Node) and request refactors/rename/organize imports; apply text edits it returns.
- **Pros**:
  - Production-grade refactors, symbol-aware.
- **Cons**:
  - Highest complexity and boot time; coordinating an LSP inside the browser is heavy.
- **Performance**:
  - Cold boot 300–800 ms; operations thereafter are reasonably fast.

---

### Recommended Strategy: Hybrid with Fallbacks
1) Default to AST when language is TS/TSX/JS:
   - Prefer Tree-sitter for matching + splice to preserve formatting.
   - Use Babel/Recast or ts-morph for complex transforms (e.g., reprinting required).
2) For other languages or when AST fails/times out: structural search (Comby-like) if pattern provided.
3) Final safety net: contextual diff (DMP/unified diff) with fuzzy anchors.
4) Post-apply verification: run `validate_project` on changed files (ESLint) and `tsc --noEmit` (project-wide). If verification fails, auto-rollback or surface diffs + errors.

This balances reliability and performance while minimizing user-visible churn in formatting.

---

### Proposed Tool API

Tool name: `apply_structured_edits`

Payload shape (Zod in `@/lib/agentTools`):
```ts
const EditAction = z.union([
  z.object({ type: z.literal('insert'), position: z.enum(['before','after','start','end']), anchor: z.string(), content: z.string() }),
  z.object({ type: z.literal('replace'), range: z.object({ start: z.number(), end: z.number() }).optional(), target: z.string().optional(), content: z.string() }),
  z.object({ type: z.literal('delete'), target: z.string().optional(), range: z.object({ start: z.number(), end: z.number() }).optional() }),
]);

const ASTQuery = z.object({
  engine: z.enum(['tree-sitter','babel','ts-morph']).default('tree-sitter'),
  language: z.enum(['ts','tsx','js']).default('ts'),
  query: z.string(), // tree-sitter or selector expression
  template: z.string().optional(), // for replace/insert content
});

const StructuralPattern = z.object({ pattern: z.string(), replacement: z.string(), language: z.string().optional() });

const DiffPatch = z.object({
  kind: z.enum(['unified','dmp']),
  patch: z.string(),
});

export const ApplyStructuredEditsInput = z.object({
  changes: z.array(z.object({
    file: z.string(),
    strategy: z.enum(['ast','struct','diff']).default('ast'),
    ast: ASTQuery.optional(),
    struct: StructuralPattern.optional(),
    diff: DiffPatch.optional(),
  })),
  verify: z.object({ tsc: z.boolean().default(true), eslint: z.boolean().default(true), build: z.boolean().default(false), timeoutMs: z.number().default(120000) }).default({}),
});
```

Return shape:
```ts
type ApplyStructuredEditsResult = {
  results: Array<{
    file: string;
    ok: boolean;
    strategyUsed: 'ast'|'struct'|'diff';
    changesApplied: number;
    diagnostics?: { type: 'tsc'|'eslint'|'build'; output: string }[];
    error?: string;
  }>;
};
```

---

### Execution Flow
1) Server (`/api/agent/route.ts`):
   - Register tool name + Zod schema. No heavy work on server; it delegates execution to the client (like other FS tools).
   - Log tool call timing/inputs via `agentLogger` (sanitized to avoid large payloads).
2) Client (`AIAgentBar.tsx`):
   - Add `case 'apply_structured_edits'` in the tool switch.
   - For each change:
     - Read file (`fs_read`).
     - Choose strategy:
       - AST: dynamically `import('web-tree-sitter')` and grammar for TS/TSX; run query → compute splice edits; or use Babel/Recast/ts-morph for complex edits.
       - Structural: run the structural pattern engine.
       - Diff: parse/apply unified diff or DMP patches with fuzzy anchors.
     - Apply edits to string; write back (`fs_write`).
   - Batch verification: call `validate_project` with changed files list (ESLint) and run tsc project check. Report diagnostics in the tool result.
   - Performance: lazy-load heavy deps; cache parsers per language; run edits in microtasks to keep UI responsive; cap file size (e.g., 1.5 MB) with early bail-out to diff mode.

---

### Pseudocode (Client-side)
```ts
async function applyStructuredEdits(input: ApplyStructuredEditsInput): Promise<ApplyStructuredEditsResult> {
  const results = [] as ApplyStructuredEditsResult['results'];
  const changedFiles = new Set<string>();

  for (const change of input.changes) {
    try {
      const original = await readFile(change.file, 'utf-8');
      let next = original;
      let strategyUsed = change.strategy;

      if (change.strategy === 'ast' && change.ast) {
        next = await applyWithTreeSitterOrBabel(original, change.ast);
        if (next === original) throw new Error('AST edit produced no changes');
      } else if (change.strategy === 'struct' && change.struct) {
        next = applyStructuralPattern(original, change.struct);
      } else if (change.strategy === 'diff' && change.diff) {
        next = applyDiffPatch(original, change.diff);
      } else {
        // auto-select
        if (isTSLike(change.file)) {
          try { next = await applyWithTreeSitterOrBabel(original, assertDefined(change.ast)); strategyUsed = 'ast'; }
          catch { next = applyFallbackDMP(original, assertDefined(change.diff)); strategyUsed = 'diff'; }
        } else {
          next = applyFallbackDMP(original, assertDefined(change.diff)); strategyUsed = 'diff';
        }
      }

      if (next !== original) {
        await writeFile(change.file, next);
        changedFiles.add(change.file);
        results.push({ file: change.file, ok: true, strategyUsed, changesApplied: 1 });
      } else {
        results.push({ file: change.file, ok: false, strategyUsed, changesApplied: 0, error: 'No-op' });
      }
    } catch (e) {
      results.push({ file: change.file, ok: false, strategyUsed: change.strategy, changesApplied: 0, error: (e as Error).message });
    }
  }

  // Verify
  const diagnostics: { [file: string]: ApplyStructuredEditsResult['results'][number]['diagnostics'] } = {};
  if (input.verify?.eslint || input.verify?.tsc || input.verify?.build) {
    await runValidation(input.verify.build ? 'full' : 'quick', Array.from(changedFiles));
    // Collect and attach summaries from existing validation plumbing
  }

  return { results };
}
```

---

### Minimal Viable Implementation (Phased)
- **Phase 1 (fast)**: Add `apply_structured_edits` tool with only Contextual Diff (DMP) + validation. This already improves reliability over free-form fs_write.
- **Phase 2**: Add Tree-sitter for TS/TSX/JS. Provide a small set of common recipes (ensure import, add prop to JSX element, rename identifier, add function, wrap call).
- **Phase 3**: Optional Babel/Recast or ts-morph path for complex transforms (cross-file refactors, reprinting).
- **Phase 4**: Structural patterns (Comby-like) for non-TS languages used in templates.

---

### Performance & Resource Considerations
- **Bundle weight**:
  - DMP: ~20–30 KB.
  - Tree-sitter core + TS/TSX grammars: ~300–900 KB (WASM) per language; lazy-load.
  - Babel/Recast: ~400–800 KB; ts-morph + TS: multi-MB (prefer in WebContainer Node, not host bundle).
- **Latency**:
  - Simple diff apply: ~1–5 ms typical.
  - AST (tree-sitter) parse+query: ~15–60 ms for 100–300 KB.
  - Babel/recast/ts-morph cold start: 100–400 ms; warm: 30–120 ms.
- **Throughput**:
  - Batch changes sequentially to avoid UI jank; or chunk by file size. Use microtask yields and progress reporting.
- **Memory**:
  - Hold parsers per language; dispose on inactivity to keep peak memory <100 MB.

---

### Error Handling & Safety
- If an AST/structural edit throws or yields empty matches, fallback to contextual diff where possible.
- Always emit a before/after hunk snippet in logs for traceability (redacted for size).
- Run verification and, on failure, either rollback the specific file (keep backup) or surface diagnostics to the model to auto-fix.
- Cap file size for AST parsing (configurable); auto-fallback to diff for very large files.

---

### Developer Experience
- Add examples to `docs/ai-sdk/` showing tool payloads for common edits (imports, JSX prop add, function insert).
- Provide a small library of re-usable AST recipes (e.g., ensureNamedImport, addJSXProp, renameIdentifier) wrapping tree-sitter queries.
- Make the tool idempotent: re-running the same edit should detect existing changes and no-op.

---

### Security Notes
- Never execute arbitrary code from tool payloads; only interpret declarative specs.
- Validate file paths (stay within workspace); enforce max patch size.
- Sanitize logs to avoid storing full file contents; record content sizes and small prefixes only.

---

### Concrete Integration Steps
1) Define Zod schema `ApplyStructuredEditsInput` and tool name in `@/lib/agentTools`.
2) Register tool in `src/app/api/agent/route.ts` mapping to a no-op executor that defers to client (like other FS tools), but logs timing via `agentLogger`.
3) Implement client handler in `AIAgentBar.tsx`:
   - `case 'apply_structured_edits'` → orchestrate read/apply/write/validate.
   - Lazy-import `web-tree-sitter` or `diff-match-patch`.
4) Add optional `exec` flow to install heavy deps inside WebContainer if using ts-morph/Babel in Node (avoid inflating host bundle).
5) Add verification hook by calling existing `validate_project` tool with changed files.
6) Document usage patterns and payload examples; add tests for idempotence and fallback paths.

---

### Example Payloads

Add a `Button` import to `AIAgentBar.tsx` if missing (AST with tree-sitter):
```json
{
  "changes": [
    {
      "file": "src/components/AIAgentBar.tsx",
      "strategy": "ast",
      "ast": {
        "engine": "tree-sitter",
        "language": "tsx",
        "query": "(program) @root",
        "template": "import { Button } from \"@/components/ui/button\";\n"
      }
    }
  ],
  "verify": { "tsc": true, "eslint": true }
}
```

Contextual replacement in `src/app/api/agent/route.ts` (unified diff):
```json
{
  "changes": [
    {
      "file": "src/app/api/agent/route.ts",
      "strategy": "diff",
      "diff": {
        "kind": "unified",
        "patch": "--- a/src/app/api/agent/route.ts\n+++ b/src/app/api/agent/route.ts\n@@\n-    model: 'alibaba/qwen3-coder',\n+    model: 'alibaba/qwen3-coder',\n+    // TODO: enable reasoning variant when available\n"
      }
    }
  ]
}
```

---

### Conclusion
A hybrid tool that prioritizes AST-based edits for TS/TSX/JS via Tree-sitter, falls back to structural patterns, and finally to contextual diff offers the best balance of correctness, speed, and implementation complexity. It integrates cleanly with FYOS’s existing client-side tool runner, logging, and validation pipeline, and it can be rolled out incrementally with minimal risk.


