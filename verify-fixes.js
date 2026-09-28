// verify-fixes.js
//
// Run this from inside your "chawla classes" project folder:
//   node verify-fixes.js
//
// It checks every file we touched this session for the specific marker
// text that proves the fix was actually applied, and prints a clear
// PASS/FAIL list. No dependencies, just plain Node — safe to delete after
// you're done with it.

const fs = require('fs');
const path = require('path');

const checks = [
  { file: 'config/permissions.js', must: ['isSubjectAllowedForUser', 'isClassAllowedForUser'], desc: 'Class/Subject scope helpers' },
  { file: 'routes/staff.js', must: ['assignedSubjects'], desc: 'Staff: assignedSubjects field' },
  { file: 'routes/admin/classes.js', must: ['isClassAllowedForUser'], desc: 'Classes list scoping' },
  { file: 'routes/admin/subjects.js', must: ['isSubjectAllowedForUser'], desc: 'Subjects list scoping' },
  { file: 'routes/admin/attendance.js', must: ['isClassAllowedForUser'], desc: 'Attendance scoping' },
  { file: 'routes/admin/tests.js', must: ['isClassAllowedForUser', 'isSubjectAllowedForUser'], desc: 'Tests scoping' },
  { file: 'routes/admin/series.js', must: ['isClassAllowedForUser'], desc: 'Series scoping' },
  { file: 'routes/admin/homework.js', must: ['isClassAllowedForUser', "requirePermission('homework:create'), uploadHomeworkAttachment"], desc: 'Homework scoping + upload-order fix' },
  { file: 'routes/admin/doubts.js', must: ['isClassAllowedForUser'], desc: 'Doubts scoping' },
  { file: 'routes/admin/students.js', must: ['isClassAllowedForUser', 'feeStatus'], desc: 'Students list scoping + fee status' },
  { file: 'routes/admin/student-profile.js', must: ['isClassAllowedForUser', "requirePermission('students:edit'), uploadStudentDocument"], desc: 'Student profile scoping + upload-order fix' },
  { file: 'routes/admin/question-bank.js', must: ['isClassAllowedForUser', 'isSubjectAllowedForUser'], desc: 'Question Bank scoping' },
  { file: 'routes/admin/ai-review-queue.js', must: ['isClassAllowedForUser'], desc: 'AI Review Queue scoping' },
  { file: 'routes/import.js', must: ['logger.info', 'logger.error'], mustNot: ['console.log', 'console.error'], desc: 'Import logging cleanup' },
  { file: 'app.js', mustNot: ["require(\"./routes/ai\")", 'app.use("/api/ai"'], desc: 'Dead /api/ai route removed' },
  { file: 'public/admin/js/staff.js', must: ['assignedSubjects', 'subjectCheckboxesHtml'], desc: 'Staff UI: subject picker' },
  { file: 'public/admin/js/attendance.js', mustNot: ['function showAddStaffModal', 'function loadStaff'], desc: 'Attendance: old duplicate Staff code removed' },
  { file: 'public/admin/js/students.js', must: ['feeStatus'], desc: 'Students UI: fee badge' },
  { file: 'public/admin/js/ai-review-queue.js', must: ['canApprove'], desc: 'AI Review Queue: hide Approve for non-approvers' },
  { file: 'public/admin/js/questions.js', must: ["hasPermission('questions:approve')"], desc: 'Question Bank: hide Approve for non-approvers' },
  { file: 'public/admin/dashboard.html', must: ['input[type="checkbox"]', 'js/staff.js'], desc: 'Checkbox CSS fix + staff.js script tag' },
];

let pass = 0, fail = 0;
console.log('\nVerifying fixes...\n');

for (const c of checks) {
  const filePath = path.join(process.cwd(), c.file);
  if (!fs.existsSync(filePath)) {
    console.log(`❌ MISSING FILE — ${c.file}\n   (${c.desc})\n`);
    fail++;
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const missingMust = (c.must || []).filter(m => !content.includes(m));
  const presentMustNot = (c.mustNot || []).filter(m => content.includes(m));

  if (missingMust.length === 0 && presentMustNot.length === 0) {
    console.log(`✅ OK — ${c.file}  (${c.desc})`);
    pass++;
  } else {
    console.log(`❌ OUTDATED — ${c.file}  (${c.desc})`);
    if (missingMust.length) console.log(`   Missing expected text: ${missingMust.join(', ')}`);
    if (presentMustNot.length) console.log(`   Still contains old text: ${presentMustNot.join(', ')}`);
    console.log('');
    fail++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Result: ${pass} OK, ${fail} need attention`);
console.log('='.repeat(50));
if (fail > 0) {
  console.log('\nFor every ❌ above, re-paste that file from our chat and replace it in your project, then run this script again.');
} else {
  console.log('\nAll fixes from this session are correctly applied. 🎉');
}