import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import recast from 'recast';

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', '.next'];

/**
 * Recursively find all .js files in a directory
 */
function findJsFiles(dir) {
  const files = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Parse JS file and return AST. Return null if parse fails.
 */
function parseJsFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parser.parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'optionalChaining',
        'nullishCoalescingOperator',
        'logicalAssignment',
        'decorators-legacy',
      ],
    });
  } catch (error) {
    console.error(`Failed to parse ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Calculate SHA256 hash of a string
 */
function calculateHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 7);
}

/**
 * Normalize function source: remove comments, extra whitespace
 */
function normalizeFunctionBody(code) {
  // Remove single-line comments
  code = code.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove extra whitespace
  code = code.replace(/\s+/g, ' ').trim();
  return code;
}

/**
 * Get line and column from node
 */
function getNodeLocation(node) {
  return {
    line: node.loc?.start?.line || 0,
    column: node.loc?.start?.column || 0,
  };
}

/**
 * Read entire file content
 */
function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Write file with content
 */
function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Extract source code for a node using start/end positions
 */
function extractNodeSource(fileContent, node) {
  if (!node.start || node.end === undefined) {
    return '';
  }
  return fileContent.substring(node.start, node.end);
}

/**
 * Parse markdown to extract checked items
 */
function parseMarkdown(content) {
  const checked = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*-\s+\[x\]\s+(.+)$/i);
    if (match) {
      checked.push(match[1].trim());
    }
  }

  return checked;
}

/**
 * Generate markdown content for unused/duplicate functions
 */
function generateMarkdown(unused, duplicateGroups) {
  let md = '# Unused / Duplicate Functions\n\n';

  if (unused.length > 0) {
    md += '## Unused\n\n';
    for (const fn of unused) {
      const id = fn.id;
      md += `- [ ] ${id}\n`;
      md += `  Name: ${fn.name}\n`;
      md += `  File: ${fn.file}\n`;
      md += `  Line: ${fn.line}\n\n`;
    }
  }

  if (duplicateGroups.length > 0) {
    md += '## Duplicate Groups\n\n';
    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      md += `### Group ${i + 1}\n\n`;
      for (const fn of group) {
        md += `- [ ] ${fn.id}\n`;
        md += `  ${fn.file}\n`;
        md += `  ${fn.name}\n\n`;
      }
    }
  }

  return md;
}

export {
  findJsFiles,
  parseJsFile,
  calculateHash,
  normalizeFunctionBody,
  getNodeLocation,
  readFile,
  writeFile,
  extractNodeSource,
  parseMarkdown,
  generateMarkdown,
  traverse,
  recast,
};
