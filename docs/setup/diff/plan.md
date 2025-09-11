## Plan: Implement `code_edit_ast` (Client-Side, Recast)

I am choosing a single, decisive approach: a client-side AST editor built on Recast + @babel/parser, exposed as a new agent tool `code_edit_ast` and executed inside `AIAgentBar.tsx`. This avoids native bindings (tree-sitter) and heavy compiler APIs (ts-morph), keeps bundle size reasonable via dynamic import, works for TS/TSX/JS, and preserves formatting well enough for deterministic edits. No hybrid/fallback logic; this is the only editing tool for this scope.

---

## Outcomes

- Add a first-class tool `code_edit_ast` for robust edits using AST matching.
- Support a focused set of deterministic actions: `upsertImport`, `updateFunctionBody`, `replaceJsxElement`, `replaceJsxAttributes`, `insertAfterLastImport`, `insertAtTop`.
- Return precise metadata: `applied`, `edits[]`, `previewDiff`, `elapsedMs`.
- Keep execution client-side to operate directly on the WebContainer filesystem via existing `fs_*` helpers.

---

## Step-by-Step Implementation

### 1) Install Dependencies

- Add libraries:
  - `recast`
  - `@babel/parser`
  - `diff` (for user-friendly preview diffs)

Command:
```bash
pnpm add recast @babel/parser diff
```

### 2) Define Input/Output Schemas

- Update `src/lib/agentTools.ts`:
  - Add `TOOL_NAMES.code_edit_ast = 'code_edit_ast'`.
  - Add `CodeEditAstInput` zod schema with fields:
    - `path: string`
    - `action: 'upsertImport' | 'updateFunctionBody' | 'replaceJsxElement' | 'replaceJsxAttributes' | 'insertAfterLastImport' | 'insertAtTop'`
    - `selector?: { functionName?: string; exported?: boolean; jsxTag?: string }`
    - `payload?: { import?: { module: string; specifiers: string[] }; functionBody?: string; jsxReplaceWith?: string; jsxAttributes?: Record<string, string | boolean | number>; insertText?: string }`
    - `dryRun?: boolean` (default false)
  - Export the schema and name.

### 3) Register Tool on Server (Schema Only)

- Edit `src/app/api/agent/route.ts` tools map:
  - Add an entry for `TOOL_NAMES.code_edit_ast` with `description` and `inputSchema: CodeEditAstInput`.
  - Do not implement `execute` on the server; this tool is client-executed in `AIAgentBar.tsx` (same pattern as `fs_*`).

### 4) Implement Client Transformer Module

- Create `src/lib/code-edit/recastEdit.ts`.
- Export `applyAstEdit(input: CodeEditAstInput & { content: string }): Promise<{ applied: boolean; code: string; edits: Array<{ start: number; end: number }>; previewDiff: string; elapsedMs: number }>`.
- Implementation directives:
  - Use `@babel/parser` with plugins: `typescript`, `jsx`, `decorators-legacy`, `classProperties`.
  - Parse with Recast via custom parser option:
    - `recast.parse(src, { parser: { parse: yourBabelParseFn } })`.
  - Implement action handlers:
    - `upsertImport`: find or create `ImportDeclaration` for `payload.import.module`; add any missing named specifiers; alphabetize specifiers.
    - `updateFunctionBody`: locate a top-level `FunctionDeclaration` with `id.name == selector.functionName` (fallback within file only: `VariableDeclaration` whose init is `ArrowFunctionExpression` with same identifier). Replace body content between braces. Do not cross-file.
    - `replaceJsxElement`: find first `JSXElement` whose opening `name.name == selector.jsxTag`; replace entire element with `payload.jsxReplaceWith` parsed as JSX.
    - `replaceJsxAttributes`: find first matching `JSXOpeningElement` by tag; replace attributes with the provided key/value pairs; preserve existing order where possible.
    - `insertAfterLastImport`: find last `ImportDeclaration` and insert `payload.insertText` (verbatim) on a new line after it.
    - `insertAtTop`: insert `payload.insertText` at file start.
  - Print using `recast.print(ast, { tabWidth: 2 })`.
  - Produce `edits` as a single range covering the minimal changed slice (compute with a simple line-LCS or `diff` to bound the first and last changed indices).
  - Generate `previewDiff` using `diff` (unified format, capped at ~400 lines).
  - Respect `dryRun`: if true, never write; only return metadata.

### 5) Wire Tool Execution in `AIAgentBar.tsx`

- Add a new case inside the `onToolCall` switch: `case 'code_edit_ast':`.
- Behavior:
  1. Validate WebContainer instance is ready (already handled).
  2. Read file content via `fnsRef.current.readFile(path, 'utf-8')`.
  3. Lazy-load transformer to minimize initial bundle:
     - `const { applyAstEdit } = await import('@/lib/code-edit/recastEdit')`.
  4. Call `applyAstEdit({ ...tc.input, content })`.
  5. If `dryRun !== true` and `applied`, write back via `fnsRef.current.writeFile(path, result.code)`.
  6. Respond with `addToolResult({ tool: 'code_edit_ast', output: { ok: true, applied, edits, previewDiff, path, elapsedMs } })`.
  7. On error, respond with `{ ok: false, error: message, path }`.

### 6) Logging and Telemetry

- Rely on existing step logging in `route.ts` (tool calls + sanitized inputs). Client returns summarizeable output (no full code) to avoid log bloat.
- Include `edits.length`, `elapsedMs`, and `bytesChanged` in the result payload for observability.

### 7) Validation Hooks (Optional, Model-Driven)

- Do not auto-run validation from within the tool; keep tool single-purpose.
- The model may call `validate_project` as a separate step, passing `[path]` to lint/type-check only changed files.

### 8) Guardrails and Limits

- Reject files larger than 1 MB with a clear error.
- Reject actions missing required selectors/payload with zod.
- Limit `replaceJsxElement` and `replaceJsxAttributes` to the first match per call.
- Enforce single-file edit per tool call.

### 9) Few-Shot Calls for the Agent

- Upsert import:
```json
{"tool":"code_edit_ast","args":{"path":"src/lib/utils/date.ts","action":"upsertImport","payload":{"import":{"module":"@/lib/utils","specifiers":["cn"]}}}}
```

- Replace function body:
```json
{"tool":"code_edit_ast","args":{"path":"src/lib/math.ts","action":"updateFunctionBody","selector":{"functionName":"calculateTotal","exported":true},"payload":{"functionBody":"return items.reduce((s, x) => s + x.price, 0);"}}}
```

- Replace JSX element:
```json
{"tool":"code_edit_ast","args":{"path":"src/apps/settings/index.tsx","action":"replaceJsxElement","selector":{"jsxTag":"SettingsPanel"},"payload":{"jsxReplaceWith":"<SettingsPanel theme=\"dark\" />"}}}
```

### 10) Developer Test Checklist

- Create a tiny fixture component and run:
  - Upsert an import specifier
  - Replace a function body
  - Replace a JSX element and attributes
- Verify `previewDiff` is meaningful and bounded
- Confirm file writes only occur when `dryRun !== true`
- Manually run `pnpm lint` to ensure no formatting/lint regressions

---

## Non-Goals (Explicit)

- No tree-sitter integration
- No ts-morph integration
- No hybrid/fallback cascade across approaches
- No cross-file symbol resolution or refactors beyond the selected file

---

## Timeline (Effort-Driven)

- Day 1: Dependencies, schemas, tool wiring, `upsertImport`, `insert*`
- Day 2: `updateFunctionBody`, `replaceJsxElement`, `replaceJsxAttributes`, diffs
- Day 3: Hardening (edge cases, large files), docs, validation of 5–10 scenarios

---

## Rollback Plan

- The tool is additive. If issues arise, disable `code_edit_ast` in `route.ts` tools map and revert `AIAgentBar.tsx` case. No migrations required.


