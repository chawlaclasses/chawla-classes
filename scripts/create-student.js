const bcrypt = require('bcryptjs');
const db = require('../services/jsonDb');

async function createStudent() {
    console.log('👤 Creating student user...');
    
    // Check if student exists
    const existing = db.findOne('users', { email: 'student@example.com' });
    if (existing) {
        console.log('✅ Student already exists:');
        console.log(`   Email: ${existing.email}`);
        console.log(`   Name: ${existing.name}`);
        console.log(`   Class ID: ${existing.classId || 'Not assigned'}`);
        return;
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash('student123', 10);
    
    // Create student
    const student = db.insertOne('users', {
        name: 'Student User',
        email: 'student@example.com',
        password: hashedPassword,
        role: 'student',
        classId: null,
        isActive: true
    });
    
    console.log('✅ Student created successfully:');
    console.log(`   ID: ${student._id}`);
    console.log(`   Name: ${student.name}`);
    console.log(`   Email: ${student.email}`);
    console.log(`   Password: student123`);
    console.log(`   Role: ${student.role}`);
    console.log('\n⚠️ Note: This student is not assigned to any class yet.');
}

createStudent().catch(console.error);