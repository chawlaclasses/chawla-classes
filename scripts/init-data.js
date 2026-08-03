const fs = require('fs');
const path = require('path');

const collections = [
  'classes',
  'subjects', 
  'series',
  'tests',
  'testQuestions',
  'studentAttempts',
  'results',
  'users'
];

const dataDir = path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

collections.forEach(name => {
  const filePath = path.join(dataDir, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
    console.log(`✅ Created ${name}.json`);
  }
});

console.log('✅ All data files initialized');