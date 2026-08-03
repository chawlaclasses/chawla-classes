const bcrypt = require('bcryptjs');
const db = require('../services/jsonDb');

async function createAdmin() {
  const existing = db.findOne('users', { email: 'admin@chawlaclasses.com' });
  
  if (existing) {
    console.log('✅ Admin already exists');
    return;
  }
  
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  const admin = db.insertOne('users', {
    name: 'Admin',
    email: 'admin@chawlaclasses.com',
    password: hashedPassword,
    role: 'admin',
    classId: null,
    isActive: true
  });
  
  console.log('✅ Admin created:');
  console.log(`   Email: admin@chawlaclasses.com`);
  console.log(`   Password: admin123`);
  console.log(`   ID: ${admin._id}`);
}

createAdmin();