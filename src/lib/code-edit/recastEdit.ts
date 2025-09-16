import * as recast from 'recast';
import * as parser from '@babel/parser';
import { diffLines } from 'diff';
import type { Change } from 'diff';
import * as t from '@babel/types';
import type { TCodeEditAstInput } from '@/lib/agentTools';

const { namedTypes: n } = recast.types;
const { builders: b } = recast.types;

const PARSER_PLUGINS: parser.ParserPlugin[] = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'objectRestSpread',
  'asyncGenerators',
  'functionBind',
  'exportDefaultFrom',
  'exportNamespaceFrom',
  'dynamicImport',
  'nullishCoalescingOperator',
  'optionalChaining',
];

function parseFile(source: string): t.File {
  return recast.parse(source, {
    parser: {
      parse(code: string) {
        return parser.parse(code, {
          sourceType: 'module',
          allowImportExportEverywhere: true,
          plugins: PARSER_PLUGINS,
        });
      },
    },
  }) as unknown as t.File;
}

function parseExpression(source: string): t.Expression {
  const file = parseFile(`const __temp = (${source});`);
  const declaration = file.program.body[0];
  if (!declaration || declaration.type !== 'VariableDeclaration') {
    throw new Error('Failed to parse JSX replacement expression');
  }
  const declarator = declaration.declarations[0];
  if (!declarator || declarator.type !== 'VariableDeclarator' || !declarator.init) {
    throw new Error('Failed to resolve parsed expression');
  }
  return declarator.init;
}

interface EditResult {
  applied: boolean;
  code: string;
  edits: Array<{ start: number; end: number }>;
  previewDiff: string;
  elapsedMs: number;
}

interface AstEditInput extends Omit<TCodeEditAstInput, 'dryRun'> {
  content: string;
}

/**
 * Apply AST-based edits to TypeScript/JavaScript code using Recast
 */
export async function applyAstEdit(input: AstEditInput): Promise<EditResult> {
  const startTime = performance.now();
  
  try {
    // Guard against large files
    if (input.content.length > 1024 * 1024) { // 1MB limit
      throw new Error('File too large (>1MB). AST editing is limited to smaller files.');
    }

    // Parse the source code using Babel parser with TypeScript and JSX support
    const ast = parseFile(input.content);

    let applied = false;

    // Apply the requested transformation
    switch (input.action) {
      case 'upsertImport':
        applied = upsertImport(ast, input);
        break;
      case 'updateFunctionBody':
        applied = updateFunctionBody(ast, input);
        break;
      case 'replaceJsxElement':
        applied = replaceJsxElement(ast, input);
        break;
      case 'replaceJsxAttributes':
        applied = replaceJsxAttributes(ast, input);
        break;
      case 'insertAfterLastImport':
        applied = insertAfterLastImport(ast, input);
        break;
      case 'insertAtTop':
        applied = insertAtTop(ast, input);
        break;
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }

    // Generate the new code
    const newCode = recast.print(ast, {
      tabWidth: 2,
      reuseWhitespace: true,
      quote: 'single',
    }).code;

    // Calculate diff and edits
    const diff = diffLines(input.content, newCode);
    const edits = calculateEdits(diff);
    const previewDiff = generatePreviewDiff(diff);

    const elapsedMs = Math.round(performance.now() - startTime);

    return {
      applied,
      code: newCode,
      edits,
      previewDiff,
      elapsedMs,
    };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startTime);
    throw new Error(`AST edit failed: ${error instanceof Error ? error.message : String(error)} (${elapsedMs}ms)`);
  }
}

/**
 * Upsert an import statement - add missing specifiers or create new import
 */
function upsertImport(ast: t.File, input: AstEditInput): boolean {
  if (!input.payload?.import) {
    throw new Error('upsertImport requires payload.import with module and specifiers');
  }

  const { module, specifiers } = input.payload.import;
  const body = ast.program.body;

  // Find existing import for this module
  let existingImport: t.ImportDeclaration | null = null;
  for (const node of body) {
    if (node.type === 'ImportDeclaration' && node.source.value === module) {
      existingImport = node;
      break;
    }
  }

  if (existingImport) {
    // Add missing specifiers to existing import
    const existingSpecifiers = new Set(
      existingImport.specifiers
        .filter(
          (spec): spec is t.ImportSpecifier & { imported: t.Identifier } =>
            spec.type === 'ImportSpecifier' && spec.imported.type === 'Identifier'
        )
        .map((spec) => spec.imported.name)
    );

    let added = false;
    for (const specifier of specifiers) {
      if (!existingSpecifiers.has(specifier)) {
        const localId = t.identifier(specifier);
        const importedId = t.identifier(specifier);
        const newSpecifier = t.importSpecifier(localId, importedId);
        existingImport.specifiers.push(newSpecifier);
        added = true;
      }
    }

    // Sort specifiers alphabetically
    if (added) {
      existingImport.specifiers.sort((a, b) => {
        if (a.type !== 'ImportSpecifier' || b.type !== 'ImportSpecifier') return 0;
        if (a.imported.type !== 'Identifier' || b.imported.type !== 'Identifier') return 0;
        return a.imported.name.localeCompare(b.imported.name);
      });
    }

    return added;
  } else {
    // Create new import declaration
    const importSpecifiers = specifiers.map((spec) =>
      t.importSpecifier(t.identifier(spec), t.identifier(spec))
    );

    const newImport = t.importDeclaration(importSpecifiers, t.stringLiteral(module));

    // Insert after other imports or at the beginning
    let insertIndex = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i].type === 'ImportDeclaration') {
        insertIndex = i + 1;
      } else {
        break;
      }
    }

    body.splice(insertIndex, 0, newImport);
    return true;
  }
}

/**
 * Update the body of a function (declaration or arrow function in variable)
 */
function updateFunctionBody(ast: t.File, input: AstEditInput): boolean {
  if (!input.selector?.functionName || !input.payload?.functionBody) {
    throw new Error('updateFunctionBody requires selector.functionName and payload.functionBody');
  }

  const { functionName } = input.selector;
  const { functionBody } = input.payload;
  const body = ast.program.body;

  // Look for function declaration first
  for (const node of body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name === functionName) {
      // Parse the new function body
      const bodyAst = parseFile(`function temp() { ${functionBody} }`);
      const tempNode = bodyAst.program.body[0];
      if (!tempNode || tempNode.type !== 'FunctionDeclaration') {
        throw new Error('Failed to parse new function body');
      }
      node.body = tempNode.body;
      return true;
    }

    // Look for arrow function in variable declaration
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (
          declarator.id?.type === 'Identifier' &&
          declarator.id.name === functionName &&
          declarator.init?.type === 'ArrowFunctionExpression'
        ) {
          const bodyAst = parseFile(`const temp = () => { ${functionBody} };`);
          const tempDecl = bodyAst.program.body[0];
          if (!tempDecl || tempDecl.type !== 'VariableDeclaration') {
            throw new Error('Failed to parse arrow function body');
          }
          const tempVar = tempDecl.declarations[0];
          if (!tempVar || tempVar.type !== 'VariableDeclarator' || !tempVar.init || tempVar.init.type !== 'ArrowFunctionExpression') {
            throw new Error('Parsed arrow function has unexpected shape');
          }
          declarator.init.body = tempVar.init.body;
          return true;
        }
      }
    }

    // Look for export default function
    if (
      node.type === 'ExportDefaultDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration' &&
      node.declaration.id?.name === functionName
    ) {
      const bodyAst = parseFile(`function temp() { ${functionBody} }`);
      const tempNode = bodyAst.program.body[0];
      if (!tempNode || tempNode.type !== 'FunctionDeclaration') {
        throw new Error('Failed to parse export default function body');
      }
      node.declaration.body = tempNode.body;
      return true;
    }
  }

  return false;
}

/**
 * Replace a JSX element with new JSX content
 */
function replaceJsxElement(ast: t.File, input: AstEditInput): boolean {
  if (!input.selector?.jsxTag || !input.payload?.jsxReplaceWith) {
    throw new Error('replaceJsxElement requires selector.jsxTag and payload.jsxReplaceWith');
  }

  const { jsxTag } = input.selector;
  const { jsxReplaceWith } = input.payload;

  // Parse the replacement JSX
  const replacementExpression = parseExpression(jsxReplaceWith);
  if (replacementExpression.type !== 'JSXElement' && replacementExpression.type !== 'JSXFragment') {
    throw new Error('Replacement JSX must evaluate to a JSX element or fragment');
  }

  // Find and replace the first matching JSX element
  let found = false;
  recast.visit(ast, {
    visitJSXElement(path) {
      if (found) {
        return false;
      }
      const opening = path.node.openingElement;
      if (n.JSXIdentifier.check(opening.name) && opening.name.name === jsxTag) {
        path.replace(replacementExpression);
        found = true;
        return false; // Stop traversing
      }
      this.traverse(path);
    },
  });

  return found;
}

/**
 * Replace JSX attributes on a matching element
 */
function replaceJsxAttributes(ast: t.File, input: AstEditInput): boolean {
  if (!input.selector?.jsxTag || !input.payload?.jsxAttributes) {
    throw new Error('replaceJsxAttributes requires selector.jsxTag and payload.jsxAttributes');
  }

  const { jsxTag } = input.selector;
  const { jsxAttributes } = input.payload;

  let found = false;
  recast.visit(ast, {
    visitJSXOpeningElement(path) {
      if (found) {
        return false;
      }
      const name = path.node.name;
      if (n.JSXIdentifier.check(name) && name.name === jsxTag) {
        // Create new attributes
        const newAttributes = Object.entries(jsxAttributes).map(([key, value]) => {
          let attrValue;
          if (typeof value === 'string') {
            attrValue = b.stringLiteral(value);
          } else if (typeof value === 'boolean') {
            attrValue = value ? null : b.jsxExpressionContainer(b.booleanLiteral(false));
          } else if (typeof value === 'number') {
            attrValue = b.jsxExpressionContainer(b.numericLiteral(value));
          } else {
            attrValue = b.stringLiteral(String(value));
          }

          return b.jsxAttribute(b.jsxIdentifier(key), attrValue);
        });

        // Replace all attributes
        path.node.attributes = newAttributes;
        found = true;
        return false; // Stop traversing
      }
      this.traverse(path);
    },
  });

  return found;
}

/**
 * Insert text after the last import statement
 */
function insertAfterLastImport(ast: t.File, input: AstEditInput): boolean {
  if (!input.payload?.insertText) {
    throw new Error('insertAfterLastImport requires payload.insertText');
  }

  const { insertText } = input.payload;
  const body = ast.program.body;

  // Find the last import
  let lastImportIndex = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i].type === 'ImportDeclaration') {
      lastImportIndex = i;
    }
  }

  // Parse the text to insert
  const insertAst = parseFile(insertText);

  const insertIndex = lastImportIndex >= 0 ? lastImportIndex + 1 : 0;
  body.splice(insertIndex, 0, ...(insertAst.program.body as t.Statement[]));
  
  return true;
}

/**
 * Insert text at the top of the file
 */
function insertAtTop(ast: t.File, input: AstEditInput): boolean {
  if (!input.payload?.insertText) {
    throw new Error('insertAtTop requires payload.insertText');
  }

  const { insertText } = input.payload;
  const body = ast.program.body;

  // Parse the text to insert
  const insertAst = parseFile(insertText);

  body.splice(0, 0, ...(insertAst.program.body as t.Statement[]));
  return true;
}

/**
 * Calculate edit ranges from diff
 */
function calculateEdits(diff: Change[]): Array<{ start: number; end: number }> {
  const edits: Array<{ start: number; end: number }> = [];
  let lineNumber = 0;
  let editStart = -1;

  for (const change of diff) {
    if (change.added || change.removed) {
      if (editStart === -1) {
        editStart = lineNumber;
      }
    } else {
      if (editStart !== -1) {
        edits.push({ start: editStart, end: lineNumber - 1 });
        editStart = -1;
      }
      lineNumber += change.count || 0;
    }
  }

  // Handle case where diff ends with changes
  if (editStart !== -1) {
    edits.push({ start: editStart, end: lineNumber });
  }

  return edits;
}

/**
 * Generate a preview diff string (capped at ~400 lines)
 */
function generatePreviewDiff(diff: Change[]): string {
  const lines: string[] = [];
  let lineCount = 0;
  const maxLines = 400;

  for (const change of diff) {
    const prefix = change.added ? '+' : change.removed ? '-' : ' ';
    const changeLines = change.value.split('\n');
    
    for (let i = 0; i < changeLines.length - 1; i++) { // -1 to skip empty line at end
      if (lineCount >= maxLines) {
        lines.push('... (diff truncated)');
        return lines.join('\n');
      }
      lines.push(prefix + changeLines[i]);
      lineCount++;
    }
  }

  return lines.join('\n');
}
