const bcrypt = require('bcryptjs');
const db = require('../services/jsonDb');

async function resetStudentPassword() {
    console.log('🔑 Resetting student password...');
    
    // Find student
    const student = db.findOne('users', { email: 'student@example.com' });
    
    if (!student) {
        console.log('❌ Student not found. Creating new student...');
        const hashedPassword = await bcrypt.hash('student123', 10);
        const newStudent = db.insertOne('users', {
            name: 'Student User',
            email: 'student@example.com',
            password: hashedPassword,
            role: 'student',
            classId: 'mr1xcl1a938nrqtb7',
            isActive: true
        });
        console.log('✅ Student created successfully!');
        console.log(`   ID: ${newStudent._id}`);
        console.log(`   Email: student@example.com`);
        console.log(`   Password: student123`);
        console.log(`   Class ID: ${newStudent.classId}`);
        return;
    }
    
    // Reset password
    const hashedPassword = await bcrypt.hash('student123', 10);
    db.findByIdAndUpdate('users', student._id, {
        password: hashedPassword,
        isActive: true,
        classId: 'mr1xcl1a938nrqtb7'
    });
    
    console.log('✅ Student password reset successfully!');
    console.log(`   Email: ${student.email}`);
    console.log(`   Password: student123`);
    console.log(`   Class ID: mr1xcl1a938nrqtb7`);
    console.log(`   ID: ${student._id}`);
}

resetStudentPassword().catch(console.error);