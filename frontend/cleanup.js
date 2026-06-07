const fs = require('fs');
const path = require('path');

const deadImports = [
  'excalidraw-wrapper',
  'whiteboard-canvas',
  'animated-shader-background',
  'motion-footer',
  'tour-celebration',
  'code-block',
  'code-editor-canvas'
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Remove import lines
  const lines = content.split('\n');
  const newLines = lines.filter(line => {
    if (line.includes('import ') && deadImports.some(di => line.includes(di))) {
      modified = true;
      return false; // drop this line
    }
    return true;
  });

  if (modified) {
    fs.writeFileSync(filePath, newLines.join('\n'));
    console.log('Cleaned imports in:', filePath);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
      processFile(fullPath);
    }
  }
}

walkDir('./src');
console.log('Cleanup complete.');
