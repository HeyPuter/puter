#!/usr/bin/env node

/**
 * Port Conflict Resolution Script for Puter
 *
 * This script helps resolve port conflicts when there's an issue with the setup wizard
 * redirecting back and forth between ports. It clears the setup completion marker,
 * sets a specific port, and starts Puter cleanly.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration paths
const runtimeConfigDir = path.join(
  process.cwd(),
  "volatile",
  "runtime",
  "config"
);
const setupCompletedPath = path.join(runtimeConfigDir, "setup-completed");
const wizardConfigPath = path.join(runtimeConfigDir, "wizard-config.json");

// Check if running as root/admin
const isRoot = process.getuid && process.getuid() === 0;
if (isRoot) {
  console.log(
    "⚠️  Running this script as root/administrator is not recommended"
  );
  console.log("Press Ctrl+C to cancel or wait 5 seconds to continue anyway...");
  // Wait 5 seconds
  execSync("sleep 5");
}

// Create a banner
console.log("\n" + "=".repeat(80));
console.log(" ".repeat(25) + "PUTER PORT CONFLICT RESOLVER");
console.log("=".repeat(80) + "\n");

// Ensure runtime config directory exists
if (!fs.existsSync(runtimeConfigDir)) {
  console.log(`📁 Creating runtime config directory: ${runtimeConfigDir}`);
  fs.mkdirSync(runtimeConfigDir, { recursive: true });
}

// Check for running Puter processes
try {
  console.log("🔍 Checking for running Puter processes...");
  const processes = execSync(
    'ps aux | grep -v grep | grep -E "node.*puter|npm.*start"'
  ).toString();

  if (processes) {
    console.log(
      "\n⚠️  Found running Puter processes. Please stop them before continuing:"
    );
    console.log(processes);
    console.log("Use the following command to stop all Puter processes:");
    console.log('  pkill -f "node.*puter|npm.*start"\n');
    process.exit(1);
  }
} catch (err) {
  // No processes found, which is good
  console.log("✅ No running Puter processes found");
}

// Handle setup marker
if (fs.existsSync(setupCompletedPath)) {
  console.log(`🗑️  Removing setup completed marker: ${setupCompletedPath}`);
  fs.unlinkSync(setupCompletedPath);
} else {
  console.log(`ℹ️  Setup completed marker not found at: ${setupCompletedPath}`);
}

// Handle wizard config
if (fs.existsSync(wizardConfigPath)) {
  console.log(`🔄 Backing up wizard config: ${wizardConfigPath}`);
  fs.copyFileSync(wizardConfigPath, `${wizardConfigPath}.bak`);

  try {
    // Read and modify wizard config
    const wizardConfig = JSON.parse(fs.readFileSync(wizardConfigPath, "utf8"));
    console.log("📝 Current wizard configuration:");
    console.log(JSON.stringify(wizardConfig, null, 2));
  } catch (err) {
    console.log(`⚠️  Error reading wizard config: ${err.message}`);
  }
}

// Ask user what port to use
console.log("\n📋 Port Selection Options:");
console.log("1) Use automatic port selection (recommended)");
console.log("2) Specify a port manually");

const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question("\n👉 Enter your choice (1 or 2): ", (choice) => {
  let port;

  if (choice === "2") {
    readline.question("Enter port number to use: ", (portInput) => {
      port = parseInt(portInput.trim(), 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        console.log("❌ Invalid port number. Must be between 1024 and 65535.");
        readline.close();
        process.exit(1);
      }
      startPuter(port);
      readline.close();
    });
  } else {
    // Default to automatic port selection
    console.log("✅ Using automatic port selection");
    startPuter(null);
    readline.close();
  }
});

function startPuter(port) {
  console.log("\n🚀 Starting Puter with clean configuration...");

  const env = { ...process.env };
  if (port) {
    env.PORT = port;
    console.log(`🔌 Setting PORT=${port}`);
  }

  console.log("\n👉 Run the following command to start Puter:");
  if (port) {
    console.log(`   PORT=${port} npm start\n`);
  } else {
    console.log("   npm start\n");
  }

  console.log("After setup is complete, you may need to:");
  console.log("1. Restart your browser or use an incognito window");
  console.log("2. Clear browser cookies for the Puter domain");
  console.log("3. Access Puter using the correct port shown in the console\n");

  console.log("=".repeat(80));
}
