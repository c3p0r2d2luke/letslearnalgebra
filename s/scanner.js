import fs from 'fs';
import path from 'path';
import * as shared from './shared.js';

/**
 * Get contextual name for anonymous functions based on parent context
 */
function getContextualName(nodePath, type) {
  const parent = nodePath.parent;
  const grandparent = nodePath.parentPath?.parent;

  // Variable declarator: const foo = () => {}
  if (parent.type === 'VariableDeclarator' && parent.id?.name) {
    return parent.id.name;
  }

  // Assignment: obj.foo = () => {} or foo = () => {}
  if (parent.type === 'AssignmentExpression') {
    if (parent.left?.property?.name) {
      return parent.left.property.name;
    }
    if (parent.left?.name) {
      return parent.left.name;
    }
  }

  // Object property: { foo: () => {} }
  if (parent.type === 'ObjectProperty' && parent.key?.name) {
    return parent.key.name;
  }

  // Shorthand method: { foo() {} }
  if (parent.type === 'ObjectMethod' && parent.key?.name) {
    return parent.key.name;
  }

  // Return statement: return () => {}
  if (parent.type === 'ReturnStatement') {
    return 'return()';
  }

  // Array element: [() => {}]
  if (parent.type === 'ArrayExpression') {
    const index = parent.elements.indexOf(nodePath.node);
    return `array[${index}]`;
  }

  // Spread element: [..., () => {}]
  if (parent.type === 'SpreadElement') {
    return 'spread(...)';
  }

  // New expression: new Foo(() => {})
  if (parent.type === 'NewExpression') {
    const className = parent.callee?.name || 'Class';
    const argIndex = parent.arguments.indexOf(nodePath.node);
    return `new ${className}(arg${argIndex})`;
  }

  // Call expression argument: arr.map((x) => x)
  if (parent.type === 'CallExpression') {
    const calleeObj = parent.callee?.object?.name || parent.callee?.property?.name;
    const method = parent.callee?.property?.name;
    const arg = parent.callee?.name;
    const argIndex = parent.arguments.indexOf(nodePath.node);

    // Method call with callback
    if (method && calleeObj) {
      return `${calleeObj}.${method}(arg${argIndex})`;
    }
    // Direct call with callback
    if (arg) {
      return `${arg}(arg${argIndex})`;
    }
    // Property method call
    if (method) {
      return `${method}(arg${argIndex})`;
    }
  }

  // Promise then/catch: promise.then(() => {})
  if (parent.type === 'CallExpression' && parent.callee?.property?.name) {
    const method = parent.callee.property.name;
    if (method === 'then' || method === 'catch' || method === 'finally') {
      return `promise.${method}()`;
    }
  }

  // Property in object literal as parameter: { callback: () => {} }
  if (parent.type === 'ObjectProperty' && grandparent?.type === 'ObjectExpression') {
    const propName = parent.key?.name;
    if (propName) {
      return propName;
    }
  }

  // Default to anonymous
  return 'anonymous';
}

/**
 * Scanner: Analyze all JS files in a project and detect unused/duplicate functions
 */
async function main() {
  const projectRoot = process.cwd();
  console.log(`Scanning JavaScript files in ${projectRoot}...\n`);

  // Step 1: Find all JS files
  const jsFiles = shared.findJsFiles(projectRoot);
  console.log(`Scanning ${jsFiles.length} files...\n`);

  // Step 2: Collect all functions
  const allFunctions = [];
  const functionMap = new Map(); // id -> function info

  for (const filePath of jsFiles) {
    const relPath = path.relative(projectRoot, filePath);
    const fileContent = shared.readFile(filePath);
    const ast = shared.parseJsFile(filePath);

    if (!ast) {
      continue;
    }

    shared.traverse(ast, {
      FunctionDeclaration(nodePath) {
        const node = nodePath.node;
        const name = node.id?.name || 'anonymous';
        const loc = shared.getNodeLocation(node);
        const source = shared.extractNodeSource(fileContent, node);
        const normalizedBody = shared.normalizeFunctionBody(source);
        const bodyHash = shared.calculateHash(normalizedBody);
        const id = shared.calculateHash(filePath + name + loc.line);

        const fnInfo = {
          id,
          name,
          file: relPath,
          type: 'FunctionDeclaration',
          line: loc.line,
          start: node.start,
          end: node.end,
          hash: bodyHash,
          normalizedSource: normalizedBody,
          exported: isExported(nodePath),
          node,
        };

        allFunctions.push(fnInfo);
        functionMap.set(id, fnInfo);
      },

      ArrowFunctionExpression(nodePath) {
        const node = nodePath.node;
        const parent = nodePath.parent;
        let name = getContextualName(nodePath, 'arrow');

        const loc = shared.getNodeLocation(node);
        const source = shared.extractNodeSource(fileContent, node);
        const normalizedBody = shared.normalizeFunctionBody(source);
        const bodyHash = shared.calculateHash(normalizedBody);
        const id = shared.calculateHash(filePath + name + loc.line);

        const fnInfo = {
          id,
          name,
          file: relPath,
          type: 'ArrowFunctionExpression',
          line: loc.line,
          start: node.start,
          end: node.end,
          hash: bodyHash,
          normalizedSource: normalizedBody,
          exported: isExported(nodePath),
          node,
        };

        allFunctions.push(fnInfo);
        functionMap.set(id, fnInfo);
      },

      FunctionExpression(nodePath) {
        const node = nodePath.node;
        const parent = nodePath.parent;
        let name = node.id?.name || getContextualName(nodePath, 'function');

        const loc = shared.getNodeLocation(node);
        const source = shared.extractNodeSource(fileContent, node);
        const normalizedBody = shared.normalizeFunctionBody(source);
        const bodyHash = shared.calculateHash(normalizedBody);
        const id = shared.calculateHash(filePath + name + loc.line);

        const fnInfo = {
          id,
          name,
          file: relPath,
          type: 'FunctionExpression',
          line: loc.line,
          start: node.start,
          end: node.end,
          hash: bodyHash,
          normalizedSource: normalizedBody,
          exported: isExported(nodePath),
          node,
        };

        allFunctions.push(fnInfo);
        functionMap.set(id, fnInfo);
      },

      ClassMethod(nodePath) {
        const node = nodePath.node;
        const name = node.key?.name || 'anonymous';
        const loc = shared.getNodeLocation(node);
        const source = shared.extractNodeSource(fileContent, node);
        const normalizedBody = shared.normalizeFunctionBody(source);
        const bodyHash = shared.calculateHash(normalizedBody);
        const id = shared.calculateHash(filePath + name + loc.line);

        const fnInfo = {
          id,
          name,
          file: relPath,
          type: 'ClassMethod',
          line: loc.line,
          start: node.start,
          end: node.end,
          hash: bodyHash,
          normalizedSource: normalizedBody,
          exported: false,
          node,
        };

        allFunctions.push(fnInfo);
        functionMap.set(id, fnInfo);
      },
    });
  }

  console.log(`Found ${allFunctions.length} functions\n`);

  // Step 3: Build reference graph
  const referenceCount = new Map();
  allFunctions.forEach((fn) => {
    referenceCount.set(fn.id, 0);
  });

  const functionNames = new Set(allFunctions.map((fn) => fn.name));

  for (const filePath of jsFiles) {
    const fileContent = shared.readFile(filePath);
    const ast = shared.parseJsFile(filePath);

    if (!ast) {
      continue;
    }

    shared.traverse(ast, {
      Identifier(nodePath) {
        const node = nodePath.node;
        const name = node.name;

        if (!functionNames.has(name)) {
          return;
        }

        // Skip if this is the function declaration itself
        if (nodePath.isReferencedIdentifier() || nodePath.isBindingIdentifier()) {
          const binding = nodePath.scope.getBinding(name);
          if (binding && binding.kind === 'hoisted') {
            // This is a function declaration reference
            for (const fn of allFunctions) {
              if (fn.name === name && !isDeclarationNode(nodePath)) {
                const ref = referenceCount.get(fn.id) || 0;
                referenceCount.set(fn.id, ref + 1);
              }
            }
          }
        }

        // Count references to object properties like obj.foo or window.foo
        if (nodePath.isReferencedIdentifier()) {
          for (const fn of allFunctions) {
            if (fn.name === name) {
              const ref = referenceCount.get(fn.id) || 0;
              referenceCount.set(fn.id, ref + 1);
            }
          }
        }
      },

      CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        let fnName = null;

        if (callee.type === 'Identifier') {
          fnName = callee.name;
        } else if (callee.type === 'MemberExpression' && callee.property?.name) {
          fnName = callee.property.name;
        }

        if (fnName && functionNames.has(fnName)) {
          for (const fn of allFunctions) {
            if (fn.name === fnName) {
              const ref = referenceCount.get(fn.id) || 0;
              referenceCount.set(fn.id, ref + 1);
            }
          }
        }
      },

      NewExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (callee.type === 'Identifier') {
          const fnName = callee.name;
          if (functionNames.has(fnName)) {
            for (const fn of allFunctions) {
              if (fn.name === fnName) {
                const ref = referenceCount.get(fn.id) || 0;
                referenceCount.set(fn.id, ref + 1);
              }
            }
          }
        }
      },
    });
  }

  // Step 4: Find unused functions
  const unused = [];

  for (const fn of allFunctions) {
    const count = referenceCount.get(fn.id) || 0;

    // Be conservative: if exported, on window/globalThis, or as event listener, keep it
    if (fn.exported) {
      continue;
    }

    if (count === 0) {
      unused.push(fn);
    }
  }

  console.log(`Unused: ${unused.length}\n`);

  // Step 5: Detect duplicates
  const groupsByHash = new Map();

  for (const fn of allFunctions) {
    if (!groupsByHash.has(fn.hash)) {
      groupsByHash.set(fn.hash, []);
    }
    groupsByHash.get(fn.hash).push(fn);
  }

  const duplicateGroups = [];
  for (const [hash, group] of groupsByHash) {
    if (group.length > 1) {
      duplicateGroups.push(group);
    }
  }

  console.log(`Duplicate groups: ${duplicateGroups.length}\n`);

  // Step 6: Generate markdown
  const markdownContent = shared.generateMarkdown(unused, duplicateGroups);
  shared.writeFile('unused-functions.md', markdownContent);

  console.log('Markdown written to unused-functions.md');
}

/**
 * Check if function is exported
 */
function isExported(nodePath) {
  let currentPath = nodePath;
  let depth = 0;

  while (currentPath && depth < 5) {
    const parent = currentPath.parent;
    if (parent?.type === 'ExportNamedDeclaration') {
      return true;
    }
    if (parent?.type === 'ExportDefaultDeclaration') {
      return true;
    }
    currentPath = currentPath.parentPath;
    depth++;
  }

  // Check if assigned to module.exports or exports
  if (nodePath.parent?.type === 'AssignmentExpression') {
    const left = nodePath.parent.left;
    if (
      (left.type === 'MemberExpression' &&
        left.object?.name === 'module' &&
        left.property?.name === 'exports') ||
      (left.type === 'MemberExpression' && left.object?.name === 'exports') ||
      (left.type === 'Identifier' && (left.name === 'module' || left.name === 'exports'))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if this is a declaration node (not a reference)
 */
function isDeclarationNode(nodePath) {
  const parent = nodePath.parent;
  if (parent.type === 'FunctionDeclaration' && parent.id === nodePath.node) {
    return true;
  }
  if (parent.type === 'VariableDeclarator' && parent.id === nodePath.node) {
    return true;
  }
  return false;
}

main().catch(console.error);
