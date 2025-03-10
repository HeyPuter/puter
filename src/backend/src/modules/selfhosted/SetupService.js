/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const BaseService = require("../../services/BaseService");
const { Endpoint } = require("../../util/expressutil");
const fs = require("fs").promises;
const path = require("path");
const { get_user } = require("../../helpers");
const { USERNAME } = require("../../constants");

/**
 * Setup wizard service for initial Puter configuration
 * Self-registers via boot hook
 */
class SetupService extends BaseService {
  static register(services) {
    services.registerService("setup-wizard", SetupService);
    return true;
  }

  async _init() {
    this.log.info("Initializing Setup Wizard Service");

    // Register the default configuration steps
    this.registerDefaultConfigSteps();

    // Check if setup is completed
    this.setupCompleted = await this.isSetupCompleted();

    if (!this.setupCompleted) {
      this.log.info("Setup not completed, wizard will be displayed");
    } else {
      this.log.info("Setup already completed, skipping wizard");
    }
  }

  /**
   * Helper method for safe logging
   */
  safeLog(level, message, data) {
    if (this.log && typeof this.log[level] === "function") {
      this.log[level](message, data);
    }
  }

  /**
   * Check if setup has been completed
   */
  async isSetupCompleted() {
    try {
      const configPath = path.join(process.cwd(), "config", "setup-completed");
      await fs.access(configPath);
      return true;
    } catch (error) {
      // File doesn't exist, setup not completed
      return false;
    }
  }

  /**
   * Mark setup as completed
   */
  async markSetupCompleted() {
    try {
      const configDir = path.join(process.cwd(), "config");
      this.safeLog("info", `Ensuring config directory exists at: ${configDir}`);

      // Create config directory if it doesn't exist
      try {
        await fs.mkdir(configDir, { recursive: true });
        this.safeLog("info", "Config directory created or already exists");
      } catch (err) {
        this.safeLog("error", "Error creating config directory", err);
        // Continue anyway, as the error might be that the directory already exists
      }

      // Write a marker file to indicate setup is complete
      const setupCompletedPath = path.join(configDir, "setup-completed");
      this.safeLog(
        "info",
        `Writing setup completed marker to: ${setupCompletedPath}`
      );

      try {
        await fs.writeFile(
          setupCompletedPath,
          new Date().toISOString(),
          "utf8"
        );
        this.safeLog(
          "info",
          "Setup completed marker file written successfully"
        );
        this.setupCompleted = true;
        return true;
      } catch (writeErr) {
        this.safeLog("error", "Error writing setup-completed file", writeErr);
        throw writeErr;
      }
    } catch (error) {
      this.safeLog("error", "Failed to mark setup as completed", error);
      throw error;
    }
  }

  /**
   * Hook into boot.consolidation to register the service
   */
  ["__on_boot.consolidation"]() {
    this.log.info("Setup Wizard Service consolidated");
  }

  /**
   * Installs setup wizard routes when web server initializes
   */
  ["__on_install.routes"](_, { app }) {
    // Safe logging
    const safeLog = (level, message, data) => {
      if (this.log && typeof this.log[level] === "function") {
        this.log[level](message, data);
      }
    };

    safeLog("info", "Installing setup wizard routes");

    // === SECURITY ENHANCEMENT: Setup Token Generation ===
    // Generate a random setup token on first run to protect the setup wizard
    const crypto = require("crypto");
    const tokenPath = path.join(process.cwd(), "config", "setup-token");
    let setupToken;

    // Try to read the token if it exists
    try {
      setupToken = fs.readFileSync(tokenPath, "utf8").trim();
      safeLog("info", "Using existing setup token");
    } catch (error) {
      // Generate a new token if it doesn't exist
      setupToken = crypto.randomBytes(32).toString("hex");
      try {
        // Ensure config directory exists
        try {
          fs.mkdirSync(path.join(process.cwd(), "config"), { recursive: true });
        } catch (err) {
          // Directory may already exist
        }
        fs.writeFileSync(tokenPath, setupToken, "utf8");
        safeLog("info", "Generated new setup token");
      } catch (err) {
        safeLog("error", "Failed to save setup token", err);
        // Continue without token protection if we can't save it
        setupToken = null;
      }
    }

    // Security middleware to verify setup token
    const verifySetupToken = (req, res, next) => {
      // Skip token verification if setup is already completed
      if (this.setupCompleted) {
        return next();
      }

      // Skip token verification if no token was generated (fallback)
      if (!setupToken) {
        return next();
      }

      // Check for token in query string or headers
      const providedToken = req.query.token || req.headers["x-setup-token"];

      // Allow the initial setup page access without token
      if (req.path === "/__setup" && req.method === "GET") {
        return next();
      }

      if (providedToken === setupToken) {
        return next();
      } else {
        // For API endpoints, return a JSON error
        if (
          req.path.startsWith("/__setup/") &&
          req.path !== "/__setup/status"
        ) {
          return res.status(401).json({
            success: false,
            message: "Unauthorized access to setup wizard",
          });
        }

        // For the setup page without a token, show token information
        if (req.path === "/__setup" && !req.query.token) {
          return res.send(this.getSetupTokenHTML(setupToken));
        }

        return res.status(401).send("Unauthorized access to setup wizard");
      }
    };

    // Apply the security middleware to all setup routes
    app.use("/__setup", verifySetupToken);

    // Status endpoint
    Endpoint({
      route: "/__setup/status",
      methods: ["GET"],
      handler: async (req, res) => {
        res.json({ setupCompleted: this.setupCompleted });
      },
    }).attach(app);

    // === CONFIGURATION RESET FEATURE ===
    // Endpoint to reset configuration and re-run setup wizard
    Endpoint({
      route: "/__setup/reset",
      methods: ["POST"],
      handler: async (req, res) => {
        try {
          // Require authentication for reset
          const adminUsername = "admin";
          const user = await get_user({
            username: adminUsername,
            cached: false,
          });

          // Verify password if provided
          if (req.body && req.body.adminPassword) {
            const bcrypt = require("bcrypt");
            const isValidPassword = await bcrypt.compare(
              req.body.adminPassword,
              user.password
            );

            if (!isValidPassword) {
              return res.status(401).json({
                success: false,
                message: "Invalid admin password",
              });
            }
          } else {
            // If no password provided, require token
            const providedToken =
              req.query.token || req.headers["x-setup-token"];
            if (!providedToken || providedToken !== setupToken) {
              return res.status(401).json({
                success: false,
                message: "Unauthorized. Provide admin password or setup token.",
              });
            }
          }

          // Reset the setup-completed marker
          const configDir = path.join(process.cwd(), "config");
          const setupCompletedPath = path.join(configDir, "setup-completed");

          try {
            await fs.unlink(setupCompletedPath);
            this.log.info(
              "Removed setup-completed marker for configuration reset"
            );
          } catch (err) {
            // File might not exist, which is fine
            this.log.info(
              "No setup-completed marker found, continuing with reset"
            );
          }

          // Reset the internal state
          this.setupCompleted = false;

          // Generate new setup token
          const crypto = require("crypto");
          setupToken = crypto.randomBytes(32).toString("hex");

          try {
            const tokenPath = path.join(configDir, "setup-token");
            await fs.writeFile(tokenPath, setupToken, "utf8");
            this.log.info("Generated new setup token for configuration reset");
          } catch (err) {
            this.log.error("Failed to save new setup token", err);
          }

          // Success response with new token
          res.json({
            success: true,
            message:
              "Configuration reset. Setup wizard will be displayed on next visit.",
            setupToken: setupToken,
          });
        } catch (error) {
          this.log.error("Failed to reset configuration", error);
          res.status(500).json({
            success: false,
            message: "Failed to reset configuration",
            error: error.message,
          });
        }
      },
    }).attach(app);

    // Add reset instructions to the token page
    Endpoint({
      route: "/__setup/reset-instructions",
      methods: ["GET"],
      handler: async (req, res) => {
        res.send(this.getResetInstructionsHTML());
      },
    }).attach(app);

    // Wizard UI endpoint
    Endpoint({
      route: "/__setup",
      methods: ["GET"],
      handler: async (req, res) => {
        if (this.setupCompleted) {
          return res.redirect("/");
        }

        // Pass the token to the setup wizard HTML
        res.send(this.getSetupWizardHTML(req.query.token || ""));
      },
    }).attach(app);

    // Configuration endpoint
    Endpoint({
      route: "/__setup/configure",
      methods: ["POST"],
      handler: async (req, res) => {
        try {
          // Process all configuration steps
          const config = await this.processConfigSteps(req.body, req);

          // Apply configuration
          try {
            await this.updateConfig(config);
            safeLog("info", "Configuration updated successfully");
          } catch (configError) {
            safeLog("error", "Failed to update configuration", configError);
            return res.status(500).json({
              success: false,
              message: "Failed to update configuration",
              error: configError.message,
            });
          }

          // Mark setup as completed
          try {
            await this.markSetupCompleted();
            safeLog("info", "Setup marked as completed");
          } catch (setupError) {
            safeLog("error", "Failed to mark setup as completed", setupError);
            return res.status(500).json({
              success: false,
              message: "Failed to mark setup as completed",
              error: setupError.message,
            });
          }

          // Remove setup token after successful setup
          if (setupToken) {
            try {
              fs.unlinkSync(tokenPath);
              safeLog("info", "Removed setup token after successful setup");
            } catch (err) {
              safeLog("error", "Failed to remove setup token", err);
            }
          }

          // Success response
          return res.json({
            success: true,
            message: "Setup completed successfully",
          });
        } catch (error) {
          safeLog("error", "Setup configuration failed", error);
          res.status(500).json({
            success: false,
            message: "Failed to complete setup",
            error: error.message,
          });
        }
      },
    }).attach(app);

    // Middleware to redirect to setup wizard if not completed
    if (!this.setupCompleted) {
      app.use((req, res, next) => {
        if (
          req.path.startsWith("/__setup") ||
          req.path.startsWith("/api/") ||
          req.path.startsWith("/assets/")
        ) {
          return next();
        }

        // Include token in redirect if available
        const tokenParam = setupToken ? `?token=${setupToken}` : "";
        res.redirect(`/__setup${tokenParam}`);
      });
    }
  }

  /**
   * Updates configuration values
   */
  async updateConfig(newConfig) {
    try {
      // Get the current configuration
      const config = require("../../config");

      // Apply new settings
      Object.assign(config, newConfig);

      // Save configuration to a file
      const configDir = path.join(process.cwd(), "config");
      try {
        await fs.mkdir(configDir, { recursive: true });
      } catch (err) {
        // Directory might already exist
      }

      // Write the configuration to a JSON file
      const configPath = path.join(configDir, "wizard-config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify(newConfig, null, 2),
        "utf8"
      );

      this.safeLog("info", "Configuration updated", newConfig);
      return true;
    } catch (error) {
      this.safeLog("error", "Failed to update configuration", error);
      throw error;
    }
  }

  // Helper method to find a suitable database service
  async findDatabaseService() {
    try {
      // Try different service names that might provide database access
      const possibleServices = [
        "database",
        "db",
        "sql",
        "sqlite",
        "database-access",
      ];

      // Log available services
      const allServices = this.services.list();
      this.safeLog("info", "Available services:", allServices);

      // Try each possible database service
      for (const serviceName of possibleServices) {
        if (this.services.has(serviceName)) {
          const service = this.services.get(serviceName);
          this.safeLog("info", `Found database service: ${serviceName}`, {
            methods: Object.keys(service),
            hasKnex: !!service.knex,
            hasQuery: !!service.query,
          });
          return service;
        }
      }

      throw new Error("No database service found");
    } catch (error) {
      this.safeLog("error", "Error finding database service", error);
      throw error;
    }
  }

  // Update admin user password using a direct database approach
  async updateAdminPassword(password) {
    try {
      const adminUsername = "admin";
      const user = await get_user({ username: adminUsername, cached: false });

      if (!user) {
        throw new Error("Admin user not found");
      }

      // Use bcrypt to hash the password
      const bcrypt = require("bcrypt");
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // Find a suitable database service
      const dbService = await this.findDatabaseService();

      // Log what we're doing
      this.safeLog("info", `Updating password for user ID: ${user.id}`);

      // Direct SQL update to the users table
      try {
        // Using Knex if available
        if (dbService.knex) {
          await dbService
            .knex("users")
            .where("id", user.id)
            .update({ password: passwordHash });
        }
        // Using raw query as fallback
        else if (dbService.query) {
          await dbService.query("UPDATE users SET password = ? WHERE id = ?", [
            passwordHash,
            user.id,
          ]);
        } else {
          throw new Error("No suitable database access method found");
        }

        this.safeLog("info", "Admin password updated successfully");
        return true;
      } catch (dbError) {
        this.safeLog("error", "Database error updating password", dbError);
        throw new Error(`Database error: ${dbError.message}`);
      }
    } catch (error) {
      this.safeLog("error", "Failed to update admin password", error);
      throw error;
    }
  }

  /**
   * Returns the HTML for the setup wizard interface
   */
  getSetupWizardHTML(token = "") {
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Puter Setup Wizard</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --background: #ffffff;
                    --foreground: #09090b;
                    
                    --card: #ffffff;
                    --card-foreground: #09090b;
                    
                    --popover: #ffffff;
                    --popover-foreground: #09090b;
                    
                    --primary: #18181b;
                    --primary-foreground: #f8fafc;
                    
                    --secondary: #f1f5f9;
                    --secondary-foreground: #0f172a;
                    
                    --muted: #f1f5f9;
                    --muted-foreground: #64748b;
                    
                    --accent: #f1f5f9;
                    --accent-foreground: #0f172a;
                    
                    --destructive: #ef4444;
                    --destructive-foreground: #f8fafc;
                    
                    --border: #e2e8f0;
                    --input: #e2e8f0;
                    --ring: #0f172a;
                    
                    --radius: 0.5rem;
                }
                
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #f9fafb;
                    color: var(--foreground);
                    line-height: 1.5;
                }
                
                .container {
                    max-width: 550px;
                    margin: 2rem auto;
                    padding: 1.5rem;
                }
                
                .card {
                    background-color: var(--card);
                    border-radius: var(--radius);
                    box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.08);
                    overflow: hidden;
                }
                
                .card-header {
                    padding: 1.5rem;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }
                
                .logo {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 1rem;
                }
                
                .logo img {
                    height: 40px;
                }
                
                h1 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: var(--foreground);
                    margin-bottom: 0.5rem;
                }
                
                .description {
                    font-size: 0.875rem;
                    color: var(--muted-foreground);
                    max-width: 500px;
                    margin: 0 auto;
                }
                
                .card-content {
                    padding: 1.5rem;
                }
                
                .setup-form {
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                }
                
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                
                .form-group h2 {
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: var(--foreground);
                }
                
                .label {
                    font-size: 0.875rem;
                    font-weight: 500;
                    color: var(--foreground);
                }
                
                .input {
                    display: flex;
                    height: 2.5rem;
                    width: 100%;
                    border-radius: var(--radius);
                    border: 1px solid var(--input);
                    background-color: transparent;
                    padding: 0.5rem 0.75rem;
                    font-size: 0.875rem;
                    transition: border 0.2s ease;
                }
                
                .input:focus {
                    outline: none;
                    border-color: var(--ring);
                    box-shadow: 0 0 0 1px var(--ring);
                }
                
                .radio-group {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 0.5rem;
                }
                
                .radio-item {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.5rem;
                    border-radius: var(--radius);
                    border: 1px solid var(--border);
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .radio-item:hover {
                    background-color: var(--accent);
                }
                
                .radio-item.checked {
                    border-color: var(--primary);
                    background-color: var(--accent);
                }
                
                .radio-item input {
                    display: none;
                }
                
                .radio-item .radio-button {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 1px solid var(--muted-foreground);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .radio-item.checked .radio-button {
                    border-color: var(--primary);
                }
                
                .radio-item.checked .radio-button::after {
                    content: "";
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--primary);
                }
                
                .radio-item .radio-label {
                    font-size: 0.875rem;
                    font-weight: 500;
                }
                
                .alert {
                    border-radius: var(--radius);
                    padding: 0.75rem;
                    font-size: 0.875rem;
                    margin-top: 0.75rem;
                    display: flex;
                    gap: 0.5rem;
                    align-items: flex-start;
                }
                
                .alert-warning {
                    background-color: #fff7ed;
                    border: 1px solid #ffedd5;
                    color: #c2410c;
                }
                
                .alert-icon {
                    flex-shrink: 0;
                    margin-top: 0.125rem;
                }
                
                .conditional {
                    margin-top: 0.75rem;
                }
                
                .button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: var(--radius);
                    font-size: 0.875rem;
                    font-weight: 500;
                    height: 2.5rem;
                    padding-left: 1rem;
                    padding-right: 1rem;
                    transition: all 0.2s ease;
                    cursor: pointer;
                }
                
                .button-primary {
                    background-color: var(--primary);
                    color: var(--primary-foreground);
                    border: none;
                }
                
                .button-primary:hover {
                    opacity: 0.9;
                }
                
                .button-primary:active {
                    opacity: 0.8;
                }
                
                #setup-feedback {
                    margin-top: 1rem;
                    padding: 0.75rem;
                    border-radius: var(--radius);
                    font-size: 0.875rem;
                    display: none;
                }
                
                .success {
                    background-color: #ecfdf5;
                    border: 1px solid #a7f3d0;
                    color: #065f46;
                }
                
                .error {
                    background-color: #fef2f2;
                    border: 1px solid #fecaca;
                    color: #b91c1c;
                }
                
                .divider {
                    height: 1px;
                    width: 100%;
                    background-color: var(--border);
                    margin: 1.5rem 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <div class="card-header">
                        <div class="logo">
                            <img src="/assets/img/logo.svg" alt="Puter Logo">
                        </div>
                        <h1>Welcome to Puter</h1>
                        <p class="description">Complete this setup wizard to configure your Puter instance</p>
                    </div>
                    
                    <div class="card-content">
                        <form id="setup-form" class="setup-form">
                            <!-- Hidden input to store the token -->
                            <input type="hidden" id="setupToken" name="setupToken" value="${token}">
                            
                            <div class="form-group">
                                <h2>Subdomain Configuration</h2>
                                <div class="radio-group" id="subdomain-radio-group">
                                    <label class="radio-item checked" data-value="enabled">
                                        <input type="radio" name="subdomainBehavior" value="enabled" checked>
                                        <span class="radio-button"></span>
                                        <span class="radio-label">Enabled (Recommended)</span>
                                    </label>
                                    <label class="radio-item" data-value="disabled">
                                        <input type="radio" name="subdomainBehavior" value="disabled">
                                        <span class="radio-button"></span>
                                        <span class="radio-label">Disabled</span>
                                    </label>
                                </div>
                                
                                <div id="subdomain-warning" class="alert alert-warning" style="display: none;">
                                    <span class="alert-icon">⚠️</span>
                                    <span>Disabling subdomains makes your deployment less secure. Only use this option if your hosting does not support subdomains.</span>
                                </div>
                            </div>
                            
                            <div class="divider"></div>
                            
                            <div class="form-group">
                                <h2>Domain Configuration</h2>
                                <div class="radio-group" id="domain-radio-group">
                                    <label class="radio-item checked" data-value="domain">
                                        <input type="radio" name="domainType" value="domain" checked>
                                        <span class="radio-button"></span>
                                        <span class="radio-label">Custom Domain</span>
                                    </label>
                                    <label class="radio-item" data-value="nipio">
                                        <input type="radio" name="domainType" value="nipio">
                                        <span class="radio-button"></span>
                                        <span class="radio-label">Use nip.io (IP-based)</span>
                                    </label>
                                </div>
                                
                                <div id="domain-input" class="conditional">
                                    <label class="label" for="domainName">Domain Name</label>
                                    <input type="text" id="domainName" name="domainName" class="input" placeholder="e.g., yourdomain.com">
                                </div>
                                
                                <div id="nipio-info" class="conditional" style="display: none;">
                                    <div class="alert alert-warning">
                                        <span class="alert-icon">ℹ️</span>
                                        <span>Using nip.io will create a domain based on your server's IP address. Your Puter instance will be accessible at: <strong id="nipio-domain">--.--.--.---.nip.io</strong></span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="divider"></div>
                            
                            <div class="form-group">
                                <h2>Admin User Password</h2>
                                <div>
                                    <label class="label" for="adminPassword">Password</label>
                                    <input type="password" id="adminPassword" name="adminPassword" class="input" placeholder="Enter a secure password">
                                </div>
                                <div>
                                    <label class="label" for="confirmPassword">Confirm Password</label>
                                    <input type="password" id="confirmPassword" name="confirmPassword" class="input" placeholder="Confirm your password">
                                </div>
                            </div>
                            
                            <div class="divider"></div>
                            
                            <button type="submit" id="submit-btn" class="button button-primary">Complete Setup</button>
                            
                            <div id="setup-feedback"></div>
                        </form>
                    </div>
                </div>
            </div>
            
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    // Handle radio button styling
                    function setupRadioGroup(groupId) {
                        const radioGroup = document.getElementById(groupId);
                        const radioItems = radioGroup.querySelectorAll('.radio-item');
                        
                        radioItems.forEach(item => {
                            item.addEventListener('click', () => {
                                // Remove checked class from all items
                                radioItems.forEach(i => i.classList.remove('checked'));
                                
                                // Add checked class to the clicked item
                                item.classList.add('checked');
                                
                                // Check the radio input
                                const input = item.querySelector('input');
                                input.checked = true;
                                
                                // Trigger change event
                                const event = new Event('change');
                                input.dispatchEvent(event);
                            });
                        });
                    }
                    
                    // Setup radio groups
                    setupRadioGroup('subdomain-radio-group');
                    setupRadioGroup('domain-radio-group');
                    
                    // Get user's IP for nip.io domain
                    fetch('/__setup/status?token=${token}')
                        .then(response => response.json())
                        .then(data => {
                            // If setup is completed, redirect to home
                            if (data.setupCompleted) {
                                window.location.href = '/';
                            }
                        });
                    
                    // Update nip.io preview
                    const userIp = window.location.hostname.split(':')[0];
                    document.getElementById('nipio-domain').textContent = userIp.replace(/\\./g, '-') + '.nip.io';
                    
                    // Toggle subdomain warning
                    document.querySelector('input[name="subdomainBehavior"]').addEventListener('change', function(e) {
                        const warningEl = document.getElementById('subdomain-warning');
                        warningEl.style.display = e.target.value === 'disabled' ? 'block' : 'none';
                    });
                    
                    // Toggle domain/nip.io inputs
                    document.querySelector('input[name="domainType"]').addEventListener('change', function(e) {
                        const domainInput = document.getElementById('domain-input');
                        const nipioInfo = document.getElementById('nipio-info');
                        
                        if (e.target.value === 'domain') {
                            domainInput.style.display = 'block';
                            nipioInfo.style.display = 'none';
                        } else {
                            domainInput.style.display = 'none';
                            nipioInfo.style.display = 'block';
                        }
                    });
                    
                    // Form submission
                    document.getElementById('setup-form').addEventListener('submit', function(e) {
                        e.preventDefault();
                        
                        // Validate form
                        const adminPassword = document.getElementById('adminPassword').value;
                        const confirmPassword = document.getElementById('confirmPassword').value;
                        const domainType = document.querySelector('input[name="domainType"]:checked').value;
                        const domainName = document.getElementById('domainName').value;
                        
                        if (adminPassword !== confirmPassword) {
                            showFeedback('Passwords do not match', false);
                            return;
                        }
                        
                        if (domainType === 'domain' && !domainName) {
                            showFeedback('Please enter a domain name', false);
                            return;
                        }
                        
                        // Get the token value
                        const token = document.getElementById('setupToken').value;
                        
                        // Prepare data for submission
                        const formData = {
                            subdomainBehavior: document.querySelector('input[name="subdomainBehavior"]:checked').value,
                            domainName: domainName,
                            useNipIo: domainType === 'nipio',
                            adminPassword: adminPassword
                        };
                        
                        // Submit button loading state
                        const submitBtn = document.getElementById('submit-btn');
                        submitBtn.textContent = 'Setting up...';
                        submitBtn.disabled = true;
                        
                        // Submit configuration with token in headers
                        fetch('/__setup/configure?token=' + token, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Setup-Token': token
                            },
                            body: JSON.stringify(formData)
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                showFeedback('Setup completed successfully! Redirecting...', true);
                                setTimeout(() => {
                                    window.location.href = '/';
                                }, 2000);
                            } else {
                                showFeedback('Error: ' + data.message, false);
                                submitBtn.textContent = 'Complete Setup';
                                submitBtn.disabled = false;
                            }
                        })
                        .catch(error => {
                            showFeedback('Error: ' + error.message, false);
                            submitBtn.textContent = 'Complete Setup';
                            submitBtn.disabled = false;
                        });
                    });
                    
                    function showFeedback(message, isSuccess) {
                        const feedbackEl = document.getElementById('setup-feedback');
                        feedbackEl.textContent = message;
                        feedbackEl.className = isSuccess ? 'success' : 'error';
                        feedbackEl.style.display = 'block';
                    }
                });
            </script>
        </body>
        </html>
    `;

    // Return the HTML with all styles and content preserved
    return html
      .replace("/* Styles remain unchanged */", this.getWizardStyles())
      .replace(
        "<!-- Form content remains unchanged -->",
        this.getWizardFormContent()
      );
  }

  // Extract styles to a separate method for better maintainability
  getWizardStyles() {
    return `
            :root {
                --background: #ffffff;
                --foreground: #09090b;
                
                --card: #ffffff;
                --card-foreground: #09090b;
                
                --popover: #ffffff;
                --popover-foreground: #09090b;
                
                --primary: #18181b;
                --primary-foreground: #f8fafc;
                
                --secondary: #f1f5f9;
                --secondary-foreground: #0f172a;
                
                --muted: #f1f5f9;
                --muted-foreground: #64748b;
                
                --accent: #f1f5f9;
                --accent-foreground: #0f172a;
                
                --destructive: #ef4444;
                --destructive-foreground: #f8fafc;
                
                --border: #e2e8f0;
                --input: #e2e8f0;
                --ring: #0f172a;
                
                --radius: 0.5rem;
            }
            
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background-color: #f9fafb;
                color: var(--foreground);
                line-height: 1.5;
            }
            
            .container {
                max-width: 550px;
                margin: 2rem auto;
                padding: 1.5rem;
            }
            
            .card {
                background-color: var(--card);
                border-radius: var(--radius);
                box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.08);
                overflow: hidden;
            }
            
            .card-header {
                padding: 1.5rem;
                border-bottom: 1px solid var(--border);
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
            }
            
            .logo {
                display: flex;
                justify-content: center;
                margin-bottom: 1rem;
            }
            
            .logo img {
                height: 40px;
            }
            
            h1 {
                font-size: 1.5rem;
                font-weight: 600;
                color: var(--foreground);
                margin-bottom: 0.5rem;
            }
            
            .description {
                font-size: 0.875rem;
                color: var(--muted-foreground);
                max-width: 500px;
                margin: 0 auto;
            }
            
            .card-content {
                padding: 1.5rem;
            }
            
            .setup-form {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
            }
            
            .form-group {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }
            
            .form-group h2 {
                font-size: 0.875rem;
                font-weight: 600;
                color: var(--foreground);
            }
            
            .label {
                font-size: 0.875rem;
                font-weight: 500;
                color: var(--foreground);
            }
            
            .input {
                display: flex;
                height: 2.5rem;
                width: 100%;
                border-radius: var(--radius);
                border: 1px solid var(--input);
                background-color: transparent;
                padding: 0.5rem 0.75rem;
                font-size: 0.875rem;
                transition: border 0.2s ease;
            }
            
            .input:focus {
                outline: none;
                border-color: var(--ring);
                box-shadow: 0 0 0 1px var(--ring);
            }
            
            .radio-group {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.5rem;
            }
            
            .radio-item {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem;
                border-radius: var(--radius);
                border: 1px solid var(--border);
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .radio-item:hover {
                background-color: var(--accent);
            }
            
            .radio-item.checked {
                border-color: var(--primary);
                background-color: var(--accent);
            }
            
            .radio-item input {
                display: none;
            }
            
            .radio-item .radio-button {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 1px solid var(--muted-foreground);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .radio-item.checked .radio-button {
                border-color: var(--primary);
            }
            
            .radio-item.checked .radio-button::after {
                content: "";
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--primary);
            }
            
            .radio-item .radio-label {
                font-size: 0.875rem;
                font-weight: 500;
            }
            
            .alert {
                border-radius: var(--radius);
                padding: 0.75rem;
                font-size: 0.875rem;
                margin-top: 0.75rem;
                display: flex;
                gap: 0.5rem;
                align-items: flex-start;
            }
            
            .alert-warning {
                background-color: #fff7ed;
                border: 1px solid #ffedd5;
                color: #c2410c;
            }
            
            .alert-icon {
                flex-shrink: 0;
                margin-top: 0.125rem;
            }
            
            .conditional {
                margin-top: 0.75rem;
            }
            
            .button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: var(--radius);
                font-size: 0.875rem;
                font-weight: 500;
                height: 2.5rem;
                padding-left: 1rem;
                padding-right: 1rem;
                transition: all 0.2s ease;
                cursor: pointer;
            }
            
            .button-primary {
                background-color: var(--primary);
                color: var(--primary-foreground);
                border: none;
            }
            
            .button-primary:hover {
                opacity: 0.9;
            }
            
            .button-primary:active {
                opacity: 0.8;
            }
            
            #setup-feedback {
                margin-top: 1rem;
                padding: 0.75rem;
                border-radius: var(--radius);
                font-size: 0.875rem;
                display: none;
            }
            
            .success {
                background-color: #ecfdf5;
                border: 1px solid #a7f3d0;
                color: #065f46;
            }
            
            .error {
                background-color: #fef2f2;
                border: 1px solid #fecaca;
                color: #b91c1c;
            }
            
            .divider {
                height: 1px;
                width: 100%;
                background-color: var(--border);
                margin: 1.5rem 0;
            }
    `;
  }

  // Extract form content to a separate method for better maintainability
  getWizardFormContent() {
    let html = "";

    // Generate HTML for each configuration step
    this.configSteps.forEach((step, index) => {
      html += `
        <div class="form-group" data-step-id="${step.id}">
          <h2>${step.title}</h2>
          ${step.description ? `<p class="step-description">${step.description}</p>` : ""}
          ${step.template}
        </div>
        ${index < this.configSteps.length - 1 ? '<div class="divider"></div>' : ""}
      `;
    });

    // Add the submit button and feedback area
    html += `
      <div class="divider"></div>
      <button type="submit" id="submit-btn" class="button button-primary">Complete Setup</button>
      <div id="setup-feedback"></div>
    `;

    return html;
  }

  // Templates for default configuration steps
  getSubdomainStepTemplate() {
    return `
      <div class="radio-group" id="subdomain-radio-group">
        <label class="radio-item checked" data-value="enabled">
          <input type="radio" name="subdomainBehavior" value="enabled" checked>
          <span class="radio-button"></span>
          <span class="radio-label">Enabled (Recommended)</span>
        </label>
        <label class="radio-item" data-value="disabled">
          <input type="radio" name="subdomainBehavior" value="disabled">
          <span class="radio-button"></span>
          <span class="radio-label">Disabled</span>
        </label>
      </div>
      
      <div id="subdomain-warning" class="alert alert-warning" style="display: none;">
        <span class="alert-icon">⚠️</span>
        <span>Disabling subdomains makes your deployment less secure. Only use this option if your hosting does not support subdomains.</span>
      </div>
    `;
  }

  getDomainStepTemplate() {
    return `
      <div class="radio-group" id="domain-radio-group">
        <label class="radio-item checked" data-value="domain">
          <input type="radio" name="domainType" value="domain" checked>
          <span class="radio-button"></span>
          <span class="radio-label">Custom Domain</span>
        </label>
        <label class="radio-item" data-value="nipio">
          <input type="radio" name="domainType" value="nipio">
          <span class="radio-button"></span>
          <span class="radio-label">Use nip.io (IP-based)</span>
        </label>
      </div>
      
      <div id="domain-input" class="conditional">
        <label class="label" for="domainName">Domain Name</label>
        <input type="text" id="domainName" name="domainName" class="input" placeholder="e.g., yourdomain.com">
      </div>
      
      <div id="nipio-info" class="conditional" style="display: none;">
        <div class="alert alert-warning">
          <span class="alert-icon">ℹ️</span>
          <span>Using nip.io will create a domain based on your server's IP address. Your Puter instance will be accessible at: <strong id="nipio-domain">--.--.--.---.nip.io</strong></span>
        </div>
      </div>
    `;
  }

  getPasswordStepTemplate() {
    return `
      <div>
        <label class="label" for="adminPassword">Password</label>
        <input type="password" id="adminPassword" name="adminPassword" class="input" placeholder="Enter a secure password">
      </div>
      <div>
        <label class="label" for="confirmPassword">Confirm Password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" class="input" placeholder="Confirm your password">
      </div>
    `;
  }

  // HTML template for the setup token page
  getSetupTokenHTML(token) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Puter Setup Security</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --background: #ffffff;
                    --foreground: #09090b;
                    --card: #ffffff;
                    --card-foreground: #09090b;
                    --primary: #18181b;
                    --primary-foreground: #f8fafc;
                    --secondary: #f1f5f9;
                    --secondary-foreground: #0f172a;
                    --muted: #f1f5f9;
                    --muted-foreground: #64748b;
                    --accent: #f1f5f9;
                    --accent-foreground: #0f172a;
                    --destructive: #ef4444;
                    --destructive-foreground: #f8fafc;
                    --border: #e2e8f0;
                    --input: #e2e8f0;
                    --ring: #0f172a;
                    --radius: 0.5rem;
                }
                
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #f9fafb;
                    color: var(--foreground);
                    line-height: 1.5;
                }
                
                .container {
                    max-width: 550px;
                    margin: 2rem auto;
                    padding: 1.5rem;
                }
                
                .card {
                    background-color: var(--card);
                    border-radius: var(--radius);
                    box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.08);
                    overflow: hidden;
                }
                
                .card-header {
                    padding: 1.5rem;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }
                
                .logo {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 1rem;
                }
                
                .logo img {
                    height: 40px;
                }
                
                h1 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: var(--foreground);
                    margin-bottom: 0.5rem;
                }
                
                .description {
                    font-size: 0.875rem;
                    color: var(--muted-foreground);
                    max-width: 500px;
                    margin: 0 auto;
                }
                
                .card-content {
                    padding: 1.5rem;
                }
                
                .token-display {
                    background-color: var(--muted);
                    border-radius: var(--radius);
                    padding: 1rem;
                    margin: 1.5rem 0;
                    font-family: monospace;
                    word-break: break-all;
                    text-align: center;
                    font-size: 0.875rem;
                }
                
                .button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: var(--radius);
                    font-size: 0.875rem;
                    font-weight: 500;
                    height: 2.5rem;
                    padding-left: 1rem;
                    padding-right: 1rem;
                    transition: all 0.2s ease;
                    cursor: pointer;
                    width: 100%;
                    margin-top: 1rem;
                }
                
                .button-primary {
                    background-color: var(--primary);
                    color: var(--primary-foreground);
                    border: none;
                }
                
                .button-primary:hover {
                    opacity: 0.9;
                }
                
                .alert {
                    border-radius: var(--radius);
                    padding: 0.75rem;
                    font-size: 0.875rem;
                    margin-top: 0.75rem;
                    display: flex;
                    gap: 0.5rem;
                    align-items: flex-start;
                }
                
                .alert-warning {
                    background-color: #fff7ed;
                    border: 1px solid #ffedd5;
                    color: #c2410c;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <div class="card-header">
                        <div class="logo">
                            <img src="/assets/img/logo.svg" alt="Puter Logo">
                        </div>
                        <h1>Security Token Required</h1>
                        <p class="description">To protect your Puter instance during setup, a security token is required.</p>
                    </div>
                    
                    <div class="card-content">
                        <p>Your setup security token is:</p>
                        <div class="token-display">${token}</div>
                        
                        <div class="alert alert-warning">
                            <span>⚠️</span>
                            <span>This token is only shown once and provides administrative access to configure your Puter instance. Keep it secure.</span>
                        </div>
                        
                        <a href="/__setup?token=${token}" class="button button-primary">Continue to Setup</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
  }

  // HTML template for reset instructions
  getResetInstructionsHTML() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Puter Setup Reset Instructions</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --background: #ffffff;
                    --foreground: #09090b;
                    --card: #ffffff;
                    --card-foreground: #09090b;
                    --primary: #18181b;
                    --primary-foreground: #f8fafc;
                    --secondary: #f1f5f9;
                    --secondary-foreground: #0f172a;
                    --muted: #f1f5f9;
                    --muted-foreground: #64748b;
                    --accent: #f1f5f9;
                    --accent-foreground: #0f172a;
                    --destructive: #ef4444;
                    --destructive-foreground: #f8fafc;
                    --border: #e2e8f0;
                    --input: #e2e8f0;
                    --ring: #0f172a;
                    --radius: 0.5rem;
                }
                
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', sans-serif;
                    background-color: #f9fafb;
                    color: var(--foreground);
                    line-height: 1.5;
                }
                
                .container {
                    max-width: 550px;
                    margin: 2rem auto;
                    padding: 1.5rem;
                }
                
                .card {
                    background-color: var(--card);
                    border-radius: var(--radius);
                    box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.08);
                    overflow: hidden;
                }
                
                .card-header {
                    padding: 1.5rem;
                    border-bottom: 1px solid var(--border);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }
                
                .logo {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 1rem;
                }
                
                .logo img {
                    height: 40px;
                }
                
                h1 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: var(--foreground);
                    margin-bottom: 0.5rem;
                }
                
                .description {
                    font-size: 0.875rem;
                    color: var(--muted-foreground);
                    max-width: 500px;
                    margin: 0 auto;
                }
                
                .card-content {
                    padding: 1.5rem;
                }
                
                .instructions {
                    margin-top: 1.5rem;
                    text-align: left;
                }
                
                .instructions p {
                    margin-bottom: 1rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="card">
                    <div class="card-header">
                        <div class="logo">
                            <img src="/assets/img/logo.svg" alt="Puter Logo">
                        </div>
                        <h1>Reset Instructions</h1>
                        <p class="description">Follow these steps to reset your Puter instance.</p>
                    </div>
                    
                    <div class="card-content">
                        <div class="instructions">
                            <p>1. Remove the setup-completed marker file.</p>
                            <p>2. Remove the setup-token file.</p>
                            <p>3. Restart the Puter instance.</p>
                        </div>
                        
                        <a href="/__setup" class="button button-primary">Continue to Setup</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
  }

  // Constructor to initialize basic properties
  _construct() {
    // Initialize the configuration steps registry
    this.configSteps = [];
  }

  // Register the default configuration steps
  registerDefaultConfigSteps() {
    // Register the subdomain configuration step
    this.registerConfigStep({
      id: "subdomain",
      title: "Subdomain Configuration",
      description: "Configure how subdomains work in your Puter instance",
      required: true,
      order: 10,
      template: this.getSubdomainStepTemplate(),
      process: async (data) => {
        return {
          experimental_no_subdomain: data.subdomainBehavior === "disabled",
        };
      },
    });

    // Register the domain configuration step
    this.registerConfigStep({
      id: "domain",
      title: "Domain Configuration",
      description: "Set up the domain name for your Puter instance",
      required: true,
      order: 20,
      template: this.getDomainStepTemplate(),
      process: async (data, req) => {
        return {
          domain: data.useNipIo
            ? `${req.ip.replace(/\./g, "-")}.nip.io`
            : data.domainName,
        };
      },
    });

    // Register the admin password configuration step
    this.registerConfigStep({
      id: "adminPassword",
      title: "Admin Password",
      description: "Set the password for the admin user",
      required: true,
      order: 30,
      template: this.getPasswordStepTemplate(),
      process: async (data) => {
        if (data.adminPassword && data.adminPassword.trim()) {
          try {
            await this.updateAdminPassword(data.adminPassword);
            this.safeLog("info", "Admin password updated successfully");
          } catch (passwordError) {
            this.safeLog(
              "error",
              "Failed to update admin password",
              passwordError
            );
            // Don't throw error to allow setup to continue
          }
        }
        return {};
      },
    });
  }

  /**
   * Register a new configuration step for the setup wizard
   * @param {Object} step The configuration step definition
   */
  registerConfigStep(step) {
    if (!step.id || !step.title || !step.template || !step.process) {
      throw new Error(
        "Configuration step must have id, title, template and process function"
      );
    }

    // Add the step to the registry
    this.configSteps.push({
      id: step.id,
      title: step.title,
      description: step.description || "",
      required: step.required !== false,
      order: step.order || 999,
      template: step.template,
      process: step.process,
    });

    // Sort steps by order
    this.configSteps.sort((a, b) => a.order - b.order);

    // Only log if logger is available (might not be during construction)
    if (this.log && typeof this.log.info === "function") {
      this.log.info(`Registered configuration step: ${step.id}`);
    }
  }

  /**
   * Process all configuration steps with the provided data
   */
  async processConfigSteps(data, req) {
    let config = {};

    // Process each step in order
    for (const step of this.configSteps) {
      try {
        this.safeLog("info", `Processing configuration step: ${step.id}`);
        const stepConfig = await step.process.call(this, data, req);
        config = { ...config, ...stepConfig };
      } catch (error) {
        this.safeLog("error", `Error processing step ${step.id}`, error);
        throw error;
      }
    }

    return config;
  }
}

// Self-registration when the file is required.
// This will register with the service system without modifying SelfHostedModule.js
const serviceContainer = global.services || global.__service_container__;
if (serviceContainer) {
  SetupService.register(serviceContainer);
}

module.exports = {
  SetupService,
};
