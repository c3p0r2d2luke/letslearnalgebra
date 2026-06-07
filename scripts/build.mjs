import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const entryPoints = [
  path.join(srcDir, 's', 'scripts', 'index.js'),
  path.join(srcDir, 's', 'scripts', 'script.js'),
  path.join(srcDir, 's', 'ai', 'script.js'),
  path.join(srcDir, 's', 'schoolwork', 'script.js'),
  path.join(srcDir, 's', 'schoolwork', 'gnmath.js')
];

async function cleanDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function bundleScripts() {
  await build({
    entryPoints,
    outbase: srcDir,
    outdir: distDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: false,
    minify: false,
    logLevel: 'info'
  });
}

async function copyStaticFiles() {
  await cp(srcDir, distDir, {
    recursive: true,
    force: true,
    filter(source) {
      const relativePath = path.relative(srcDir, source);

      if (!relativePath) {
        return true;
      }

      const normalizedPath = relativePath.split(path.sep).join('/');

      if (normalizedPath.endsWith('.js')) {
        return false;
      }

      return true;
    }
  });
}

async function main() {
  await cleanDist();
  await copyStaticFiles();
  await bundleScripts();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
