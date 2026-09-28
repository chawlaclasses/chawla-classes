// scripts/migrate.js
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../Data');

async function migrate() {
    console.log('🔄 Running database migrations...');
    
    try {
        const files = await fs.readdir(DATA_DIR);
        let migrationsRun = 0;

        // ─── Migration 1: Add lastLogin to users ──────────────────────
        if (files.includes('users.json')) {
            const usersPath = path.join(DATA_DIR, 'users.json');
            const users = JSON.parse(await fs.readFile(usersPath, 'utf8'));
            let modified = false;

            users.forEach(user => {
                if (!user.lastLogin) {
                    user.lastLogin = user.createdAt || new Date().toISOString();
                    modified = true;
                }
                if (!user.status) {
                    user.status = 'active';
                    modified = true;
                }
            });

            if (modified) {
                await fs.writeFile(usersPath, JSON.stringify(users, null, 2));
                console.log('✅ Migration 1: Added lastLogin and status to users');
                migrationsRun++;
            } else {
                console.log('⏭️ Migration 1: Already applied');
            }
        }

        // ─── Migration 2: Add createdAt to tests ──────────────────────
        if (files.includes('tests.json')) {
            const testsPath = path.join(DATA_DIR, 'tests.json');
            const tests = JSON.parse(await fs.readFile(testsPath, 'utf8'));
            let modified = false;

            tests.forEach(test => {
                if (!test.createdAt) {
                    test.createdAt = new Date().toISOString();
                    modified = true;
                }
                if (!test.status) {
                    test.status = 'active';
                    modified = true;
                }
            });

            if (modified) {
                await fs.writeFile(testsPath, JSON.stringify(tests, null, 2));
                console.log('✅ Migration 2: Added createdAt and status to tests');
                migrationsRun++;
            } else {
                console.log('⏭️ Migration 2: Already applied');
            }
        }

        // ─── Migration 3: Add timestamps to questions ──────────────────
        if (files.includes('questions.json')) {
            const questionsPath = path.join(DATA_DIR, 'questions.json');
            const questions = JSON.parse(await fs.readFile(questionsPath, 'utf8'));
            let modified = false;

            questions.forEach(q => {
                if (!q.createdAt) {
                    q.createdAt = new Date().toISOString();
                    modified = true;
                }
                if (!q.status) {
                    q.status = 'active';
                    modified = true;
                }
            });

            if (modified) {
                await fs.writeFile(questionsPath, JSON.stringify(questions, null, 2));
                console.log('✅ Migration 3: Added timestamps to questions');
                migrationsRun++;
            } else {
                console.log('⏭️ Migration 3: Already applied');
            }
        }

        // ─── Migration 4: Add studentId to attendance ──────────────────
        if (files.includes('attendance.json')) {
            const attendancePath = path.join(DATA_DIR, 'attendance.json');
            const attendance = JSON.parse(await fs.readFile(attendancePath, 'utf8'));
            let modified = false;

            attendance.forEach(record => {
                if (!record.studentId && record.userId) {
                    record.studentId = record.userId;
                    modified = true;
                }
            });

            if (modified) {
                await fs.writeFile(attendancePath, JSON.stringify(attendance, null, 2));
                console.log('✅ Migration 4: Added studentId to attendance');
                migrationsRun++;
            } else {
                console.log('⏭️ Migration 4: Already applied');
            }
        }

        // ─── Migration 5: Add index to results ─────────────────────────
        if (files.includes('results.json')) {
            const resultsPath = path.join(DATA_DIR, 'results.json');
            const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
            let modified = false;

            results.forEach(result => {
                if (!result.index) {
                    result.index = results.indexOf(result) + 1;
                    modified = true;
                }
            });

            if (modified) {
                await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
                console.log('✅ Migration 5: Added index to results');
                migrationsRun++;
            } else {
                console.log('⏭️ Migration 5: Already applied');
            }
        }

        console.log(`\n🎉 Migration completed! ${migrationsRun} migrations applied.`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();