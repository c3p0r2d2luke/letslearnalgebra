import fs from 'fs';
import path from 'path';
import * as shared from './shared.js';

/**
 * Apply: Read unused-functions.md and delete checked functions from source files
 */
async function main() {
  // Step 1: Read the markdown file
  const markdownPath = 'unused-functions.md';

  if (!fs.existsSync(markdownPath)) {
    console.error(`${markdownPath} not found. Run scanner.js first.`);
    process.exit(1);
  }

  const markdownContent = shared.readFile(markdownPath);

  // Step 2: Parse checked items
  const checkedIds = shared.parseMarkdown(markdownContent);

  if (checkedIds.length === 0) {
    console.log('No items checked in unused-functions.md. Nothing to delete.');
    process.exit(0);
  }

  console.log(`Reading ${markdownPath}\n`);
  console.log(`Deleting ${checkedIds.length} functions...\n`);

  let deleted = 0;
  let skipped = 0;

  // Step 3: Parse function metadata from markdown to find actual functions
  const functionsByFile = new Map();
  let isUnusedSection = false;
  let isDuplicateSection = false;

  const lines = markdownContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === '## Unused') {
      isUnusedSection = true;
      isDuplicateSection = false;
      continue;
    }

    if (line === '## Duplicate Groups') {
      isUnusedSection = false;
      isDuplicateSection = true;
      continue;
    }

    if (line.startsWith('### Group')) {
      continue;
    }

    const idMatch = line.match(/^- \[x\]\s+(.+)$/i);
    if (idMatch) {
      const id = idMatch[1].trim();
      if (checkedIds.includes(id)) {
        let fnFile = null;
        let fnName = null;
        let fnLine = null;

        // Look ahead for file, name, and line based on section type
        if (isUnusedSection) {
          // Format: - [x] ID\n  Name: name\n  File: file\n  Line: line
          if (i + 1 < lines.length) {
            const nameMatch = lines[i + 1].match(/Name:\s+(.+)$/);
            if (nameMatch) fnName = nameMatch[1].trim();
          }
          if (i + 2 < lines.length) {
            const fileMatch = lines[i + 2].match(/File:\s+(.+)$/);
            if (fileMatch) fnFile = fileMatch[1].trim();
          }
          if (i + 3 < lines.length) {
            const lineMatch = lines[i + 3].match(/Line:\s+(\d+)$/);
            if (lineMatch) fnLine = parseInt(lineMatch[1]);
          }
        } else if (isDuplicateSection) {
          // Format: - [x] ID\n  file\n  name
          if (i + 1 < lines.length) {
            const fileLine = lines[i + 1].trim();
            if (fileLine && !fileLine.startsWith('-') && !fileLine.startsWith('###')) {
              fnFile = fileLine;
            }
          }
          if (i + 2 < lines.length) {
            const nameLine = lines[i + 2].trim();
            if (nameLine && !nameLine.startsWith('-') && !nameLine.startsWith('###')) {
              fnName = nameLine;
            }
          }
        }

        if (fnFile) {
          if (!functionsByFile.has(fnFile)) {
            functionsByFile.set(fnFile, []);
          }
          functionsByFile.get(fnFile).push({ id, name: fnName, line: fnLine });
        }
      }
    }
  }

  // Step 4: Process each file and delete functions
  for (const [filePath, functionsToDelete] of functionsByFile.entries()) {
    const fullPath = path.join(process.cwd(), filePath);

    if (!fs.existsSync(fullPath)) {
      console.log(`Skipped (file not found): ${filePath}`);
      skipped++;
      continue;
    }

    const fileContent = shared.readFile(fullPath);
    const ast = shared.parseJsFile(fullPath);

    if (!ast) {
      console.log(`Skipped (parse error): ${filePath}`);
      skipped += functionsToDelete.length;
      continue;
    }

    let modified = false;
    const nodesToDelete = [];

    // Find nodes to delete by name and line number
    for (const fnToDelete of functionsToDelete) {
      let found = false;

      shared.traverse(ast, {
        FunctionDeclaration(nodePath) {
          const node = nodePath.node;
          const name = node.id?.name || 'anonymous';
          const line = node.loc?.start?.line;

          if (fnToDelete.name && name === fnToDelete.name) {
            // If we have line info, match by line; otherwise match by name alone
            if (fnToDelete.line === undefined || line === fnToDelete.line) {
              nodesToDelete.push(nodePath);
              found = true;
            }
          }
        },

        VariableDeclarator(nodePath) {
          const node = nodePath.node;
          const name = node.id?.name;
          const line = node.loc?.start?.line;

          if (
            fnToDelete.name &&
            name === fnToDelete.name &&
            (node.init?.type === 'ArrowFunctionExpression' ||
              node.init?.type === 'FunctionExpression')
          ) {
            // If we have line info, match by line; otherwise match by name alone
            if (fnToDelete.line === undefined || line === fnToDelete.line) {
              const parentPath = nodePath.parentPath;
              if (parentPath.node.declarations.length === 1) {
                nodesToDelete.push(parentPath);
                found = true;
              }
            }
          }
        },

        AssignmentExpression(nodePath) {
          const node = nodePath.node;
          const right = node.right;
          const line = node.loc?.start?.line;

          if (
            right.type === 'FunctionExpression' ||
            right.type === 'ArrowFunctionExpression'
          ) {
            if (
              node.left?.property?.name === fnToDelete.name ||
              node.left?.name === fnToDelete.name
            ) {
              // If we have line info, match by line; otherwise match by name alone
              if (fnToDelete.line === undefined || line === fnToDelete.line) {
                const exprStmt = nodePath.parentPath;
                if (exprStmt?.type === 'ExpressionStatement') {
                  nodesToDelete.push(exprStmt);
                  found = true;
                }
              }
            }
          }
        },

        ObjectProperty(nodePath) {
          const node = nodePath.node;
          const name = node.key?.name;
          const line = node.loc?.start?.line;

          if (
            fnToDelete.name &&
            name === fnToDelete.name &&
            (node.value?.type === 'FunctionExpression' ||
              node.value?.type === 'ArrowFunctionExpression')
          ) {
            // If we have line info, match by line; otherwise match by name alone
            if (fnToDelete.line === undefined || line === fnToDelete.line) {
              nodesToDelete.push(nodePath);
              found = true;
            }
          }
        },

        ClassMethod(nodePath) {
          const node = nodePath.node;
          const name = node.key?.name;
          const line = node.loc?.start?.line;

          if (fnToDelete.name && name === fnToDelete.name) {
            // If we have line info, match by line; otherwise match by name alone
            if (fnToDelete.line === undefined || line === fnToDelete.line) {
              nodesToDelete.push(nodePath);
              found = true;
            }
          }
        },
      });

      if (!found) {
        console.log(`  ✗ ${fnToDelete.name || 'anonymous'} (not found)`);
        skipped++;
      }
    }

    // Delete nodes in reverse order to maintain indices
    for (const nodePath of nodesToDelete.reverse()) {
      try {
        const nodeType = nodePath?.node?.type;

        if (!nodeType) {
          continue;
        }

        if (nodeType === 'FunctionDeclaration') {
          const name = nodePath.node.id?.name || 'anonymous';
          nodePath.remove();
          console.log(`  ✓ ${name}`);
          deleted++;
          modified = true;
        } else if (nodeType === 'VariableDeclaration') {
          const name = nodePath.node.declarations[0]?.id?.name || 'anonymous';
          nodePath.remove();
          console.log(`  ✓ ${name}`);
          deleted++;
          modified = true;
        } else if (nodeType === 'ExpressionStatement') {
          const name =
            nodePath.node.expression?.left?.property?.name ||
            nodePath.node.expression?.left?.name ||
            'anonymous';
          nodePath.remove();
          console.log(`  ✓ ${name}`);
          deleted++;
          modified = true;
        } else if (nodeType === 'ObjectProperty') {
          const name = nodePath.node.key?.name || 'anonymous';
          nodePath.remove();
          console.log(`  ✓ ${name}`);
          deleted++;
          modified = true;
        } else if (nodeType === 'ClassMethod') {
          const name = nodePath.node.key?.name || 'anonymous';
          nodePath.remove();
          console.log(`  ✓ ${name}`);
          deleted++;
          modified = true;
        }
      } catch (error) {
        // Node already deleted or other error, skip
        continue;
      }
    }

    // Rewrite file if modified
    if (modified) {
      const newCode = shared.recast.print(ast).code;
      shared.writeFile(fullPath, newCode);
    }
  }

  console.log(`\nDone.`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Skipped: ${skipped}`);
}

main().catch(console.error);
