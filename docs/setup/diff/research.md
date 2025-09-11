## Custom Diff / AST-Match Tool for Agent Code Edits

This document investigates adding a first-class "code edit" tool for the agent to make deterministic, robust edits to source files. It focuses on three distinct approaches (without hybrids/fallback chains):

- AST-edit with TypeScript tooling
- Tree-sitter query + range patch
- Anchor-based minimal diff (string-level)

Each approach includes: how it works, an input API shape, few-shot examples, matching strategies, retries within the same approach, and performance considerations. Integration targets `src/app/api/agent/route.ts` (server tool), with no changes needed in `src/components/AIAgentBar.tsx` beyond normal chat plumbing.

---

## Goals and Constraints

- Deterministic edits with high success-rate across formatting/whitespace variance
- Keep edits minimal and localized; preserve surrounding code and comments
- Return machine-usable metadata (applied ranges, preview diff) for logging and debugging
- Avoid running dev/build; rely on existing `validate_project` tool post-edit
- No automatic cross-approach fallback; choose one approach per request

---

## Approach 1: AST-Edit (TypeScript-first)

### How it works

Parse TS/TSX with a TypeScript-aware library, locate nodes via structural selectors, transform the AST, and print code while preserving formatting. Recommended libraries:

- ts-morph (TypeScript compiler API wrapper) for robust transformations
- recast + @babel/parser (with typescript, jsx plugins) for flexible printing/preservation

Notes:
- Prefer ts-morph for TypeScript/TSX repositories; excellent symbol-level operations
- Prefer recast if preservation of comments/formatting style is paramount

### API shape (tool: code_edit_ast)

```json
{
  "path": "src/components/Example.tsx",
  "language": "ts" ,
  "action": "upsertImport" | "updateFunction" | "replaceJsx" | "insertAfterNode",
  "selector": {
    "kind": "function" | "import" | "jsx" | "any",
    "name": "calculateTotal",              
    "exported": true,
    "jsxId": "SettingsPanel"               
  },
  "payload": {
    "import": { "module": "@/lib/utils", "specifiers": ["cn"] },
    "functionBody": "return items.reduce((s, x) => s + x.price, 0);",
    "jsxReplaceWith": "<SettingsPanel theme=\"dark\" />"
  },
  "print": { "format": "recast", "tabWidth": 2 }
}
```

### Few-shot examples

1) Upsert a named import

```json
{
  "path": "src/components/A.tsx",
  "action": "upsertImport",
  "selector": { "kind": "import", "name": "cn" },
  "payload": { "import": { "module": "@/lib/utils", "specifiers": ["cn"] } }
}
```

2) Replace function body

```json
{
  "path": "src/lib/math.ts",
  "action": "updateFunction",
  "selector": { "kind": "function", "name": "calculateTotal", "exported": true },
  "payload": { "functionBody": "return items.reduce((s, x) => s + x.price, 0);" }
}
```

3) Replace JSX element by identifier

```json
{
  "path": "src/apps/settings/index.tsx",
  "action": "replaceJsx",
  "selector": { "kind": "jsx", "jsxId": "SettingsPanel" },
  "payload": { "jsxReplaceWith": "<SettingsPanel theme=\"dark\" />" }
}
```

### Matching and retries (within AST approach)

- Primary match: symbol-based lookup (function name, export presence) or JSX identifier
- If not found: broaden to same-name declarations in file scope, then class members
- Final attempt: search across named/arrow functions in file only (no cross-file)
- If still not found: return a structured error with top-3 nearest candidates (string similarity on identifiers) and a code excerpt

### Performance

- Parse and transform a ~1K-line TS/TSX file: typically tens of milliseconds
- Printing with recast is slightly slower than ts-morph emit; both acceptable for on-demand edits
- Memory overhead is modest per file; cache disabled by default to keep stateless runs

When to pick AST-edit:
- Type-safe structural edits, complex JS/TS transforms, JSX component rewrites
- High reliability needed against formatting differences

---

## Approach 2: Tree-sitter Query + Range Patch

### How it works

Use node-tree-sitter with the TypeScript/TSX grammars. Run a query to locate nodes. Compute the byte range of the matched node, then splice replacement text directly into the original string without full re-printing. This preserves file formatting except for the edited region.

### API shape (tool: code_edit_treesitter)

```json
{
  "path": "src/components/A.tsx",
  "language": "tsx",
  "query": "(function_declaration name: (identifier) @fn-name (#eq? @fn-name \"calculateTotal\"))",
  "replace": {
    "target": "body", 
    "with": "{ return items.reduce((s, x) => s + x.price, 0); }"
  },
  "bounds": {
    "limitToTopLevel": true,
    "maxEdits": 1
  }
}
```

### Few-shot examples

1) Replace a function body by name

```json
{
  "path": "src/lib/math.ts",
  "query": "(function_declaration name: (identifier) @n (#eq? @n \"calculateTotal\"))",
  "replace": { "target": "body", "with": "{ return 0; }" }
}
```

2) Replace a JSX opening element attribute set

```json
{
  "path": "src/apps/settings/index.tsx",
  "query": "(jsx_opening_element name: (identifier) @id (#eq? @id \"SettingsPanel\"))",
  "replace": { "target": "attributes", "with": " theme=\"dark\" compact " }
}
```

### Matching and retries (within tree-sitter approach)

- Primary: run the provided query; if 0 results, auto-wrap in a relaxed, file-scoped query (same file only)
- If multiple results: take the first top-level match unless `bounds.limitToTopLevel = false`
- If still 0: return error with a small listing of node kinds seen in file to help refine the query

### Performance

- Tree-sitter parses ~1K-line files in low tens of ms
- No full-file re-print; only substring replacement → minimal allocations

When to pick tree-sitter:
- You want structural matching without heavy TypeScript type analysis
- Language coverage beyond TS/TSX is desired (JS, JSON, CSS with appropriate grammars)

---

## Approach 3: Anchor-Based Minimal Diff (String-Level)

### How it works

Locate a region by anchors (strings or regex) and perform a minimal, whitespace-tolerant edit only within that bounded window. This is deterministic and fast, ideal for small, localized changes (imports, config blocks, adding list items) and for non-code files (JSON, Markdown, YAML).

### API shape (tool: code_edit_anchor)

```json
{
  "path": "src/lib/config.ts",
  "anchor": {
    "start": "export const defaults = {",
    "end": "};",
    "mode": "literal" 
  },
  "operation": "insert_after" | "replace_block" | "insert_before",
  "content": "  enableAIBridge: true,\n",
  "strategy": {
    "whitespaceInsensitive": true,
    "maxWindow": 4000,
    "requireAllAnchors": true,
    "idempotentHash": true
  }
}
```

### Few-shot examples

1) Insert an import line at the top after last import

```json
{
  "path": "src/components/A.tsx",
  "anchor": { "start": "import ", "end": "\n\n", "mode": "first-block" },
  "operation": "insert_after",
  "content": "import { cn } from \"@/lib/utils\"\n",
  "strategy": { "whitespaceInsensitive": true, "idempotentHash": true }
}
```

2) Replace a known config block in JSON (literal)

```json
{
  "path": "package.json",
  "anchor": { "start": "\"scripts\": {", "end": "}\n", "mode": "literal" },
  "operation": "replace_block",
  "content": "\n  \"dev\": \"next dev\",\n  \"build\": \"next build\"\n"
}
```

### Matching tricks and retries (within anchor approach)

- Normalize newlines to \n, compare with trimming and repeated-space collapse when `whitespaceInsensitive`
- Optional regex anchors with word boundaries for identifiers
- Idempotence via content hash inside an inline comment or hidden marker when applicable
- Retries: if exact anchors not found, expand window ±N lines in the same file; single retry only. If still missing, return diagnostic with top-3 fuzzy matches (Jaccard/Levenshtein) but do not apply

### Performance

- O(n) substring scans; negligible allocations
- Very fast, suitable for tight edit loops and large files where AST cost is overkill

When to pick anchor-based:
- Small, localized textual changes; config and documentation; speed is paramount

---

## Integration Plan (Server Tool)

Add a server tool in `src/app/api/agent/route.ts` (or via `@/lib/agentTools` + import) with three distinct names so the agent selects one explicitly:

- `code_edit_ast`
- `code_edit_treesitter`
- `code_edit_anchor`

Each tool:
- Validates input with zod
- Reads the file, performs in-memory transform, produces:
  - `applied: boolean`
  - `edits: [{ path, start, end, added, removed }]`
  - `previewDiff` (unified or inline)
  - `stats: { elapsedMs }`
- Writes only if `dryRun !== true` and the transform succeeded
- Logs via `agentLogger.logToolCall` with sanitized inputs (content sizes, not full text)

No hybrid or cascade logic in the tool. The agent policy decides which one to call.

---

## Prompting and Few-Shot for the Agent

Embed short, concrete tool-call examples in the agent system prompts (or internal docs) so it formats inputs correctly:

### AST example (upsert import)

```json
{"tool":"code_edit_ast","args":{"path":"src/lib/a.ts","action":"upsertImport","selector":{"kind":"import","name":"cn"},"payload":{"import":{"module":"@/lib/utils","specifiers":["cn"]}}}}
```

### Tree-sitter example (replace function body)

```json
{"tool":"code_edit_treesitter","args":{"path":"src/lib/math.ts","language":"ts","query":"(function_declaration name: (identifier) @n (#eq? @n \"calculateTotal\"))","replace":{"target":"body","with":"{ return 0; }"}}}
```

### Anchor example (insert after block)

```json
{"tool":"code_edit_anchor","args":{"path":"src/components/A.tsx","anchor":{"start":"import ","end":"\n\n","mode":"first-block"},"operation":"insert_after","content":"import { cn } from \"@/lib/utils\"\n"}}
```

Keep the examples short and prescriptive; avoid storytelling in prompts. Emphasize that the agent must pick one approach per edit.

---

## Performance Summary

- **AST-edit**: most robust for structural TS/TSX edits; slightly higher parse/print cost; typical latency tens of ms for ~1K LOC
- **Tree-sitter**: structural matching without full type-check; fast parse; minimal substring replacement
- **Anchor-based**: fastest for simple localized changes; no structural guarantees; ideal for JSON/MD/INI/TS small patches

For all approaches, editing a few files per turn is well within typical latency budgets. Avoid batch-editing dozens of large files in a single step.

---

## Safety and Diagnostics

- Always dry-run first when `dryRun: true` is provided; return diff preview
- Enforce single-file edit per call unless `allowMultiple` is explicitly enabled
- If match fails: return a compact diagnostic with the nearest candidates and 20-line excerpt around the likely region
- After successful write, the agent may invoke `validate_project` (TypeScript + ESLint, optional build) as a separate step

---

## Implementation Notes

- Place implementation under `src/lib/code-edit/` with three modules:
  - `ast.ts` (ts-morph or recast)
  - `treesitter.ts` (node-tree-sitter; preload language grammars)
  - `anchor.ts` (string-diff with normalization and idempotent hashing)
- Export a small adapter used by the server tool to dispatch according to the chosen approach
- Keep dependencies minimal; only add what is necessary for the chosen approach

