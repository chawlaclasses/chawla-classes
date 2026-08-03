/**
 * scripts/setup.js
 * 
 * Complete setup script for Chawla Classes Server.
 * Creates all required directories and initializes data.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const DIRS = ["data", "logs", "notes", "uploads"];

console.log("🚀 Setting up Chawla Classes Server...\n");

// ── Create directories ──────────────────────────────────────────────────────

console.log("📁 Creating directories...");
for (const dir of DIRS) {
  const fullPath = path.join(ROOT_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`  ✅ Created: ${dir}/`);
  } else {
    console.log(`  ✅ Already exists: ${dir}/`);
  }
}

// ── Initialize data files ──────────────────────────────────────────────────

console.log("\n📊 Initializing data files...");
try {
  execSync("node scripts/init-data.js", { cwd: ROOT_DIR, stdio: "inherit" });
} catch (error) {
  console.error("  ❌ Failed to initialize data:", error.message);
}

// ── Create admin user ──────────────────────────────────────────────────────

console.log("\n👤 Creating admin user...");
try {
  execSync("node scripts/create-admin.js", { cwd: ROOT_DIR, stdio: "inherit" });
} catch (error) {
  console.error("  ❌ Failed to create admin:", error.message);
}

// ── Create student user ────────────────────────────────────────────────────

console.log("\n👤 Creating student user...");
try {
  execSync("node scripts/create-student.js", { cwd: ROOT_DIR, stdio: "inherit" });
} catch (error) {
  console.error("  ❌ Failed to create student:", error.message);
}

console.log("\n✅ Setup complete!");
console.log("\n📝 Next steps:");
console.log("  1. Copy .env.example to .env and update settings");
console.log("  2. Run 'npm start' to start the server");
console.log("  3. Visit http://localhost:3000");
console.log("\n🔐 Default credentials:");
console.log("  Admin: admin@chawlaclasses.com / admin123");
console.log("  Student: student@example.com / student123");