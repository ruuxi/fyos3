import * as recast from 'recast';
import * as parser from '@babel/parser';
import { diffLines } from 'diff';
import type { TCodeEditAstInput } from '@/lib/agentTools';

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
    const ast = recast.parse(input.content, {
      parser: {
        parse(source: string) {
          return parser.parse(source, {
            sourceType: 'module',
            allowImportExportEverywhere: true,
            plugins: [
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
            ],
          });
        },
      },
    });

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
function upsertImport(ast: any, input: AstEditInput): boolean {
  if (!input.payload?.import) {
    throw new Error('upsertImport requires payload.import with module and specifiers');
  }

  const { module, specifiers } = input.payload.import;
  const body = ast.program.body;

  // Find existing import for this module
  let existingImport: any = null;
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
        .filter((spec: any) => spec.type === 'ImportSpecifier')
        .map((spec: any) => spec.imported.name)
    );

    let added = false;
    for (const specifier of specifiers) {
      if (!existingSpecifiers.has(specifier)) {
        const newSpecifier = {
          type: 'ImportSpecifier',
          imported: { type: 'Identifier', name: specifier },
          local: { type: 'Identifier', name: specifier },
        };
        existingImport.specifiers.push(newSpecifier);
        added = true;
      }
    }

    // Sort specifiers alphabetically
    if (added) {
      existingImport.specifiers.sort((a: any, b: any) => {
        if (a.type !== 'ImportSpecifier' || b.type !== 'ImportSpecifier') return 0;
        return a.imported.name.localeCompare(b.imported.name);
      });
    }

    return added;
  } else {
    // Create new import declaration
    const importSpecifiers = specifiers.map((spec) => ({
      type: 'ImportSpecifier',
      imported: { type: 'Identifier', name: spec },
      local: { type: 'Identifier', name: spec },
    }));

    const newImport = {
      type: 'ImportDeclaration',
      specifiers: importSpecifiers,
      source: { type: 'StringLiteral', value: module },
    };

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
function updateFunctionBody(ast: any, input: AstEditInput): boolean {
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
      const bodyAst = recast.parse(`function temp() { ${functionBody} }`, {
        parser: {
          parse(source: string) {
            return parser.parse(source, {
              sourceType: 'module',
              plugins: ['typescript', 'jsx'],
            });
          },
        },
      });

      const tempFunc = bodyAst.program.body[0] as any;
      node.body = tempFunc.body;
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
          const bodyAst = recast.parse(`() => { ${functionBody} }`, {
            parser: {
              parse(source: string) {
                return parser.parse(source, {
                  sourceType: 'module',
                  plugins: ['typescript', 'jsx'],
                });
              },
            },
          });

          const tempArrow = bodyAst.program.body[0] as any;
          declarator.init.body = tempArrow.expression.body;
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
      const bodyAst = recast.parse(`function temp() { ${functionBody} }`, {
        parser: {
          parse(source: string) {
            return parser.parse(source, {
              sourceType: 'module',
              plugins: ['typescript', 'jsx'],
            });
          },
        },
      });

      const tempFunc = bodyAst.program.body[0] as any;
      node.declaration.body = tempFunc.body;
      return true;
    }
  }

  return false;
}

/**
 * Replace a JSX element with new JSX content
 */
function replaceJsxElement(ast: any, input: AstEditInput): boolean {
  if (!input.selector?.jsxTag || !input.payload?.jsxReplaceWith) {
    throw new Error('replaceJsxElement requires selector.jsxTag and payload.jsxReplaceWith');
  }

  const { jsxTag } = input.selector;
  const { jsxReplaceWith } = input.payload;

  // Parse the replacement JSX
  const replacementAst = recast.parse(`const temp = ${jsxReplaceWith};`, {
    parser: {
      parse(source: string) {
        return parser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
      },
    },
  });

  const replacementElement = (replacementAst.program.body[0] as any).declarations[0].init;

  // Find and replace the first matching JSX element
  let found = false;
  recast.visit(ast, {
    visitJSXElement(path: any) {
      if (!found && path.node.openingElement.name.name === jsxTag) {
        path.replace(replacementElement);
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
function replaceJsxAttributes(ast: any, input: AstEditInput): boolean {
  if (!input.selector?.jsxTag || !input.payload?.jsxAttributes) {
    throw new Error('replaceJsxAttributes requires selector.jsxTag and payload.jsxAttributes');
  }

  const { jsxTag } = input.selector;
  const { jsxAttributes } = input.payload;

  let found = false;
  recast.visit(ast, {
    visitJSXOpeningElement(path: any) {
      if (!found && path.node.name.name === jsxTag) {
        // Create new attributes
        const newAttributes = Object.entries(jsxAttributes).map(([key, value]) => {
          let attrValue;
          if (typeof value === 'string') {
            attrValue = { type: 'StringLiteral', value };
          } else if (typeof value === 'boolean') {
            attrValue = value ? null : { type: 'BooleanLiteral', value: false };
          } else if (typeof value === 'number') {
            attrValue = { type: 'JSXExpressionContainer', expression: { type: 'NumericLiteral', value } };
          } else {
            attrValue = { type: 'StringLiteral', value: String(value) };
          }

          return {
            type: 'JSXAttribute',
            name: { type: 'JSXIdentifier', name: key },
            value: attrValue,
          };
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
function insertAfterLastImport(ast: any, input: AstEditInput): boolean {
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
  const insertAst = recast.parse(insertText, {
    parser: {
      parse(source: string) {
        return parser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
      },
    },
  });

  const insertIndex = lastImportIndex >= 0 ? lastImportIndex + 1 : 0;
  body.splice(insertIndex, 0, ...insertAst.program.body);
  
  return true;
}

/**
 * Insert text at the top of the file
 */
function insertAtTop(ast: any, input: AstEditInput): boolean {
  if (!input.payload?.insertText) {
    throw new Error('insertAtTop requires payload.insertText');
  }

  const { insertText } = input.payload;
  const body = ast.program.body;

  // Parse the text to insert
  const insertAst = recast.parse(insertText, {
    parser: {
      parse(source: string) {
        return parser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        });
      },
    },
  });

  body.splice(0, 0, ...insertAst.program.body);
  return true;
}

/**
 * Calculate edit ranges from diff
 */
function calculateEdits(diff: any[]): Array<{ start: number; end: number }> {
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
function generatePreviewDiff(diff: any[]): string {
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
