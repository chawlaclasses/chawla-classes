const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');

console.log('📊 Checking all JSON files...\n');

const files = fs.readdirSync(dataDir);

files.forEach(file => {
  if (file.endsWith('.json')) {
    const filePath = path.join(dataDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;
      console.log(`✅ ${file.padEnd(20)} ${count} records`);
    } catch (error) {
      console.log(`❌ ${file.padEnd(20)} ERROR: ${error.message}`);
    }
  }
});