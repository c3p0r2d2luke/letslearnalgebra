import fs from 'fs';

const content = fs.readFileSync('unused-functions.md', 'utf-8');
const lines = content.split('\n');
let inDuplicateSection = false;
let inGroup = false;
let groupCount = 0;
let itemInGroup = 0;

for (let i = 0; i < lines.length; i++) {
  if (lines[i] === '## Duplicate Groups') {
    inDuplicateSection = true;
    continue;
  }
  
  if (inDuplicateSection && lines[i].match(/^### Group/)) {
    inGroup = true;
    itemInGroup = 0;
    groupCount++;
    continue;
  }
  
  if (inGroup && lines[i].match(/^- \[ \]/)) {
    itemInGroup++;
    // Keep first item in each group, mark others for deletion
    if (itemInGroup > 1) {
      lines[i] = lines[i].replace(/- \[ \]/, '- [x]');
    }
  }
}

fs.writeFileSync('unused-functions.md', lines.join('\n'));
console.log(`Marked ${groupCount} duplicate groups - keeping first, deleting others`);
