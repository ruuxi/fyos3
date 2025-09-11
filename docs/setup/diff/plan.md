### Implementation Plan: apply_structured_edits (Hybrid AST/Structural/Diff Editing Tool)

#### Overview
We will implement a new tool, `apply_structured_edits`, that performs deterministic code edits with a hybrid strategy (AST → structural → diff). The server declares the tool and logs calls. The client executes edits in the WebContainer using lazy‑loaded engines. Post‑edit verification uses the existing validation pipeline.

---

### 1) Add Tool Types and Names
File: `src/lib/agentTools.ts`

- Add Zod schema `ApplyStructuredEditsInput` and export it.
- Add `apply_structured_edits` to `TOOL_NAMES`.
- Define:
  - `ASTQuery` with fields: `engine: 'tree-sitter' | 'babel' | 'ts-morph'` (default `'tree-sitter'`), `language: 'ts' | 'tsx' | 'js'` (default `'ts'`), `query: string`, `template?: string`.
  - `StructuralPattern` with fields: `pattern: string`, `replacement: string`, `language?: string`.
  - `DiffPatch` with fields: `kind: 'unified' | 'dmp'`, `patch: string`.
  - `ApplyStructuredEditsInput` with fields: `changes: { file: string; strategy: 'ast' | 'struct' | 'diff'; ast?: ASTQuery; struct?: StructuralPattern; diff?: DiffPatch; }[]`, `verify: { tsc: boolean; eslint: boolean; build: boolean; timeoutMs: number; }` with defaults `{ tsc: true, eslint: true, build: false, timeoutMs: 120000 }`.

---

### 2) Register Tool on Server (Declaration and Logging Only)
File: `src/app/api/agent/route.ts`

- Import `ApplyStructuredEditsInput` and `TOOL_NAMES`.
- Register the tool under `tools` with `description`, `inputSchema: ApplyStructuredEditsInput`, and an `execute` that returns `{ delegated: true }` immediately.
- Extend `sanitizeToolInput` to handle `'apply_structured_edits'` by redacting large string fields (`template`, `patch`) and logging sizes and short previews only.

---

### 3) Implement Client Tool Executor
File: `src/components/AIAgentBar.tsx`

- In the `onToolCall` switch, add `case 'apply_structured_edits':`.
- Parse input as `ApplyStructuredEditsInput`.
- For each change:
  1. Read original with `readFile(file, 'utf-8')`.
  2. Choose engine:
     - If `strategy === 'ast'` or file extension is `.ts` | `.tsx` | `.js`, use AST engine.
     - Else if `strategy === 'struct'`, use structural engine.
     - Else if `strategy === 'diff'`, use diff engine.
  3. Apply the edit and produce `updated` string.
  4. If `updated !== original`, write with `writeFile(file, updated)` and add to `changedFiles` set; otherwise record no‑op.
- After processing all changes, run `runValidation(scope, Array.from(changedFiles))` where `scope = verify.build ? 'full' : 'quick'`.
- Return `{ results: [...] }` via `addToolResult`.

---

### 4) Editing Engines (Client-Side)
Implement three helpers in `AIAgentBar.tsx` (module‑local functions with cached state):

- `applyWithTreeSitterOrBabel(original: string, ast: { engine: string; language: string; query: string; template?: string }): Promise<string>`
  - Default path: Tree-sitter.
  - Lazy‑import `web-tree-sitter` once; initialize with `Parser.init({ locateFile: (s) => '/treesitter/' + s })`.
  - Load TS and TSX grammars from `public/treesitter/*.wasm` and cache parsers by language.
  - Execute the query to obtain anchor nodes; compute minimal string splices using `template`.
  - If Tree-sitter fails, fallback to Babel/Recast:
    - Lazy‑import `@babel/parser` and `recast`.
    - Parse with `{ sourceType: 'module', plugins: ['typescript', 'jsx'] }`.
    - Implement two built‑in transforms (see section 8) and a generic insertion at query anchors; print with recast preserving formatting.

- `applyStructuralPattern(original: string, spec: { pattern: string; replacement: string }): string`
  - Implement a simple structural search with placeholders `:[name]` mapped to `([\s\S]*?)` and word boundary guards.
  - Apply the first match; return updated string; if no match, throw.

- `applyDiffPatch(original: string, diff: { kind: 'unified' | 'dmp'; patch: string }): string`
  - For `dmp`: lazy‑import `diff-match-patch`, set `Patch_Margin = 4`, `Match_Threshold = 0.6`, apply patches and return the result (pick the `.results` string from the tuple).
  - For `unified`: parse hunks for a single target; apply with fuzzy context (trim whitespace; allow ±2 lines drift); if context not found, attempt DMP on hunk bodies as fallback.

Caching and limits:
- Keep singletons for parsers/grammars/modules in `useRef` caches.
- If file size > 1.5 MB, skip AST and use diff engine directly.
- Wrap each file’s edit in a 5s timeout; on timeout, try diff engine once; if that fails, return error without write.

---

### 5) Logging and Result Shape
- For each file, produce `{ file, ok, strategyUsed, changesApplied, diagnostics?, error? }`.
- Log only sizes and 80‑char before/after excerpts around the changed region for observability.

---

### 6) Validation Hook
- Invoke existing `runValidation` after writes using `verify` flags.
- Pass the `changedFiles` list so ESLint runs scoped to those files; TypeScript check runs project‑wide.

---

### 7) Dependencies
- `diff-match-patch`: import lazily. If not available in the WebContainer, install via `exec('pnpm', ['add', 'diff-match-patch'])` once at first use.
- `web-tree-sitter`: load lazily from ESM; no install needed.
- `@babel/parser`, `recast`: load lazily only if Tree-sitter fails; install via `exec('pnpm', ['add', '@babel/parser', 'recast'])` on first fallback use.

---

### 8) Built‑in AST Recipes (Deterministic)
Implement two recipes inside the AST engine:

1. `ensureNamedImport(specifier: string, fromPath: string)`
   - If an import from `fromPath` exists: ensure `specifier` is present (as a named import); de‑duplicate.
   - Otherwise, insert `import { <specifier> } from "<fromPath>";` at the top, after existing import block.

2. `addJSXProp(componentName: string, propName: string, propValue: string)`
   - Find the first JSXOpeningElement whose name matches `componentName`.
   - If `propName` is missing, inject `propName={propValue}` as the last attribute.

Expose these via the `ast.query` and `ast.template` convention (the engine interprets known query markers like `ensureNamedImport(...)` and `addJSXProp(...)`), otherwise treat `query` as a raw selection and `template` as the insertion.

---

### 9) Error Handling and Fallbacks
- Attempt AST for TS/TSX/JS. If it throws, falls back to structural (when provided). If that fails or not provided, apply diff engine.
- For non TS/JS files, attempt structural first (when provided), then diff.
- Never write when the computed output is identical to input; record a no‑op result.

---

### 10) API Contract (Final)
- Tool name: `apply_structured_edits`.
- Input: `ApplyStructuredEditsInput` as defined in step 1.
- Output: `{ results: Array<{ file: string; ok: boolean; strategyUsed: 'ast' | 'struct' | 'diff'; changesApplied: number; diagnostics?: { type: 'tsc' | 'eslint' | 'build'; output: string }[]; error?: string; }> }`.

---

### 11) File-by-File Edits Summary
- `src/lib/agentTools.ts`:
  - Add `TOOL_NAMES.apply_structured_edits`.
  - Add and export `ApplyStructuredEditsInput` schema.
- `src/app/api/agent/route.ts`:
  - Register tool with `ApplyStructuredEditsInput` schema; executor returns `{ delegated: true }`.
  - Extend `sanitizeToolInput` for redaction of large fields.
- `src/components/AIAgentBar.tsx`:
  - Add `apply_structured_edits` case.
  - Implement three editing engines with lazy‑loaded deps and caching.
  - Call `runValidation` once after writes.
- `public/treesitter/*`:
  - Add `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm`.
