import fs from 'fs';

const content = fs.readFileSync('unused-functions.md', 'utf-8');
const lines = content.split('\n');
let inUnusedSection = false;
const marked = [];

for (let i = 0; i < lines.length; i++) {
  if (lines[i] === '## Unused') {
    inUnusedSection = true;
    continue;
  }
  if (lines[i] === '## Duplicate Groups') {
    inUnusedSection = false;
    break;
  }
  
  if (inUnusedSection && lines[i].match(/^- \[ \]/)) {
    lines[i] = lines[i].replace(/- \[ \]/, '- [x]');
    marked.push(lines[i+1]?.trim());
  }
}

fs.writeFileSync('unused-functions.md', lines.join('\n'));
console.log(`Marked ${marked.length} unused functions for deletion`);
