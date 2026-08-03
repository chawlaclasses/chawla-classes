const db = require('../services/jsonDb');

function assignStudentClass() {
    console.log('📝 Assigning class to student...');
    
    // Find student
    const student = db.findOne('users', { email: 'student@example.com' });
    
    if (!student) {
        console.log('❌ Student not found!');
        return;
    }
    
    // Find a class
    const classData = db.findOne('classes', { isActive: true });
    
    if (!classData) {
        console.log('❌ No active class found!');
        console.log('   Please create a class first.');
        return;
    }
    
    // Assign class to student
    db.findByIdAndUpdate('users', student._id, {
        classId: classData._id
    });
    
    console.log('✅ Student assigned to class:');
    console.log(`   Student: ${student.name} (${student.email})`);
    console.log(`   Class: ${classData.displayName} (${classData._id})`);
    console.log(`   Class ID: ${classData._id}`);
}

assignStudentClass();