/**
 * scripts/health-check.js
 * 
 * Checks if the server is running and all services are healthy.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = process.env.PORT || 3000;
const HOST = "localhost";

async function healthCheck() {
  console.log("🔍 Running health check...\n");

  // ── Check directories ──────────────────────────────────────────────────────

  const dirs = ["data", "logs", "notes", "uploads"];
  let allDirsExist = true;
  
  for (const dir of dirs) {
    const fullPath = path.join(__dirname, "..", dir);
    if (!fs.existsSync(fullPath)) {
      console.log(`  ❌ Directory missing: ${dir}/`);
      allDirsExist = false;
    } else {
      console.log(`  ✅ Directory exists: ${dir}/`);
    }
  }

  if (!allDirsExist) {
    console.log("\n⚠️  Run 'npm run setup' to create missing directories.");
    return false;
  }

  // ── Check data files ──────────────────────────────────────────────────────

  const dataFiles = [
    "users.json",
    "classes.json",
    "subjects.json",
    "series.json",
    "tests.json",
    "testQuestions.json",
    "results.json",
  ];

  const dataDir = path.join(__dirname, "..", "data");
  let allDataExists = true;

  for (const file of dataFiles) {
    const fullPath = path.join(dataDir, file);
    if (!fs.existsSync(fullPath)) {
      console.log(`  ❌ Data file missing: ${file}`);
      allDataExists = false;
    } else {
      console.log(`  ✅ Data file exists: ${file}`);
    }
  }

  if (!allDataExists) {
    console.log("\n⚠️  Run 'npm run init-data' to create missing data files.");
    return false;
  }

  // ── Check server health ───────────────────────────────────────────────────

  console.log("\n🌐 Checking server status...");

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/",
        method: "HEAD",
        timeout: 3000,
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          console.log(`  ✅ Server is running on port ${PORT}`);
          console.log(`  ✅ Status code: ${res.statusCode}`);
          resolve(true);
        } else {
          console.log(`  ⚠️  Server returned status: ${res.statusCode}`);
          resolve(false);
        }
      }
    );

    req.on("error", (err) => {
      console.log(`  ❌ Server not responding: ${err.message}`);
      console.log("\n⚠️  Start the server with 'npm start'");
      resolve(false);
    });

    req.end();
  });
}

healthCheck().then((healthy) => {
  if (healthy) {
    console.log("\n✅ All checks passed!");
    process.exit(0);
  } else {
    console.log("\n❌ Health check failed. Please fix the issues above.");
    process.exit(1);
  }
});