const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');

// List of files to fix
const files = [
  'classes.json',
  'subjects.json', 
  'series.json',
  'tests.json',
  'testQuestions.json',
  'studentAttempts.json',
  'users.json'
];

console.log('🔧 Fixing JSON files...');

files.forEach(file => {
  const filePath = path.join(dataDir, file);
  try {
    // Read file
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Try to parse
    try {
      JSON.parse(content);
      console.log(`✅ ${file} is valid`);
    } catch (parseError) {
      // If invalid, write empty array
      console.log(`⚠️ ${file} is invalid, fixing...`);
      fs.writeFileSync(filePath, '[]', 'utf8');
      console.log(`✅ ${file} fixed`);
    }
  } catch (readError) {
    // If file doesn't exist, create it
    console.log(`📝 ${file} not found, creating...`);
    fs.writeFileSync(filePath, '[]', 'utf8');
    console.log(`✅ ${file} created`);
  }
});

console.log('\n✅ All JSON files fixed!');
console.log('📁 Data directory:', dataDir);