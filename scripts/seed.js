// scripts/seed.js
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../Data');

async function seedDatabase() {
    console.log('🌱 Seeding database...');
    
    try {
        // Ensure Data directory exists
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        // ─── Seed Users ──────────────────────────────────────────────────
        const users = [
            {
                id: 'student_1',
                username: 'rohit123',
                password: await bcrypt.hash('student123', 10),
                name: 'Rohit Kumar',
                role: 'student',
                class: '12',
                section: 'A',
                rollNo: '101',
                admissionNo: 'CC2025001',
                batch: '2025-26',
                email: 'rohit@example.com',
                phone: '9876543210',
                level: 12,
                xp: 2840,
                coins: 1250,
                streak: 7,
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            },
            {
                id: 'student_2',
                username: 'priya123',
                password: await bcrypt.hash('student123', 10),
                name: 'Priya Sharma',
                role: 'student',
                class: '12',
                section: 'A',
                rollNo: '102',
                admissionNo: 'CC2025002',
                batch: '2025-26',
                email: 'priya@example.com',
                phone: '9876543211',
                level: 15,
                xp: 3800,
                coins: 1800,
                streak: 12,
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            },
            {
                id: 'admin_1',
                username: 'admin',
                password: await bcrypt.hash('admin123', 10),
                name: 'Admin User',
                role: 'admin',
                email: 'admin@chawlaclasses.com',
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            }
        ];
        
        await fs.writeFile(
            path.join(DATA_DIR, 'users.json'),
            JSON.stringify(users, null, 2)
        );
        console.log('✅ Users seeded (3 records)');

        // ─── Seed Students ──────────────────────────────────────────────
        const students = users.filter(u => u.role === 'student');
        await fs.writeFile(
            path.join(DATA_DIR, 'students.json'),
            JSON.stringify(students, null, 2)
        );
        console.log('✅ Students seeded (2 records)');

        // ─── Seed Tests ──────────────────────────────────────────────────
        const tests = [
            {
                id: 'test_1',
                name: 'Mathematics - Calculus',
                subject: 'Mathematics',
                class: '12',
                batch: '2025-26',
                date: '2026-07-04',
                time: '2:00 PM',
                duration: 90,
                totalQuestions: 20,
                status: 'active',
                createdAt: new Date().toISOString()
            },
            {
                id: 'test_2',
                name: 'Physics - Mechanics',
                subject: 'Physics',
                class: '12',
                batch: '2025-26',
                date: '2026-07-06',
                time: '10:00 AM',
                duration: 60,
                totalQuestions: 15,
                status: 'active',
                createdAt: new Date().toISOString()
            },
            {
                id: 'test_3',
                name: 'Chemistry - Organic',
                subject: 'Chemistry',
                class: '12',
                batch: '2025-26',
                date: '2026-07-08',
                time: '3:30 PM',
                duration: 75,
                totalQuestions: 20,
                status: 'active',
                createdAt: new Date().toISOString()
            }
        ];
        
        await fs.writeFile(
            path.join(DATA_DIR, 'tests.json'),
            JSON.stringify(tests, null, 2)
        );
        console.log('✅ Tests seeded (3 records)');

        // ─── Seed Subjects ──────────────────────────────────────────────
        const subjects = [
            { id: 'sub_1', name: 'Mathematics', code: 'MATH', color: '#c9a84c' },
            { id: 'sub_2', name: 'Physics', code: 'PHY', color: '#3b82f6' },
            { id: 'sub_3', name: 'Chemistry', code: 'CHEM', color: '#a855f7' },
            { id: 'sub_4', name: 'Biology', code: 'BIO', color: '#22c55e' },
            { id: 'sub_5', name: 'English', code: 'ENG', color: '#fb923c' }
        ];
        
        await fs.writeFile(
            path.join(DATA_DIR, 'subjects.json'),
            JSON.stringify(subjects, null, 2)
        );
        console.log('✅ Subjects seeded (5 records)');

        // ─── Seed Questions ──────────────────────────────────────────────
        const questions = [];
        const subjectsList = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English'];
        const chapters = {
            'Mathematics': ['Algebra', 'Calculus', 'Geometry', 'Trigonometry'],
            'Physics': ['Mechanics', 'Thermodynamics', 'Optics', 'Electromagnetism'],
            'Chemistry': ['Organic', 'Inorganic', 'Physical', 'Analytical'],
            'Biology': ['Cell Biology', 'Genetics', 'Ecology', 'Human Anatomy'],
            'English': ['Grammar', 'Literature', 'Writing', 'Vocabulary']
        };
        const difficulties = ['easy', 'medium', 'hard'];
        const types = ['mcq', 'true_false', 'assertion_reason', 'numerical'];

        for (let i = 1; i <= 30; i++) {
            const subject = subjectsList[Math.floor(Math.random() * subjectsList.length)];
            const chapterList = chapters[subject] || ['General'];
            const chapter = chapterList[Math.floor(Math.random() * chapterList.length)];
            
            questions.push({
                id: `q_${i}`,
                text: `Sample question ${i} for ${subject} - ${chapter}`,
                subject: subject,
                chapter: chapter,
                difficulty: difficulties[Math.floor(Math.random() * difficulties.length)],
                type: types[Math.floor(Math.random() * types.length)],
                options: ['Option A', 'Option B', 'Option C', 'Option D'],
                correctAnswer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
                explanation: `Explanation for question ${i}`,
                marks: 1,
                status: 'active',
                createdAt: new Date().toISOString()
            });
        }

        await fs.writeFile(
            path.join(DATA_DIR, 'questions.json'),
            JSON.stringify(questions, null, 2)
        );
        console.log('✅ Questions seeded (30 records)');

        // ─── Seed Attendance ─────────────────────────────────────────────
        const attendance = [];
        const statuses = ['present', 'present', 'present', 'present', 'absent', 'late'];
        
        for (const student of students) {
            for (let day = 1; day <= 20; day++) {
                const date = new Date(2026, 5, day); // June 2026
                if (date.getDay() === 0) continue; // Skip Sundays
                
                attendance.push({
                    id: `att_${student.id}_${day}`,
                    userId: student.id,
                    date: date.toISOString(),
                    status: statuses[Math.floor(Math.random() * statuses.length)],
                    createdAt: new Date().toISOString()
                });
            }
        }

        await fs.writeFile(
            path.join(DATA_DIR, 'attendance.json'),
            JSON.stringify(attendance, null, 2)
        );
        console.log(`✅ Attendance seeded (${attendance.length} records)`);

        console.log('\n🎉 Database seeding completed successfully!');
        console.log('\n📋 Login Credentials:');
        console.log('  Student: rohit123 / student123');
        console.log('  Admin:   admin / admin123');
        
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

// Run seed
seedDatabase();