import fs from 'fs';
import path from 'path';

//
// Constants
const srcDir = 'src';
const distDir = 'dist';

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

//
// Copy all html files recursively.
function copyHtmlFiles(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach(entry => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Create subdirectory in dist and recurse
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyHtmlFiles(srcPath, destPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      // Copy HTML file
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied ${path.relative('.', srcPath)} to ${path.relative('.', destPath)}`);
    }
  });
}

copyHtmlFiles(srcDir, distDir);