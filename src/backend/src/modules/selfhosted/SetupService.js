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
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { Endpoint } = require("../../util/expressutil");
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

    // Install the admin reconfiguration endpoints
    this._installAdminReconfigEndpoints();
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
      await fsPromises.access(configPath);
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
        await fsPromises.mkdir(configDir, { recursive: true });
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
        await fsPromises.writeFile(
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
      // Token doesn't exist, so generate a new one
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
          // Verify admin password for security
          const { password } = req.body;
          if (!password) {
            return res.status(400).json({
              success: false,
              error: "Admin password is required",
            });
          }

          // Verify the admin password
          const adminUser = await get_user({
            username: "admin",
            cached: false,
          });
          if (!adminUser) {
            return res.status(404).json({
              success: false,
              error: "Admin user not found",
            });
          }

          const bcrypt = require("bcrypt");
          const passwordCorrect = await bcrypt.compare(
            password,
            adminUser.password
          );
          if (!passwordCorrect) {
            return res.status(401).json({
              success: false,
              error: "Invalid admin password",
            });
          }

          // Reset the configuration
          await this.resetConfiguration();

          return res.json({
            success: true,
            message:
              "Setup configuration has been reset. Please restart the application or refresh the page to access the setup wizard.",
          });
        } catch (error) {
          this.safeLog("error", "Error in reset endpoint", error);
          return res.status(500).json({
            success: false,
            error: "Failed to reset configuration: " + error.message,
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
              await fsPromises.unlink(tokenPath);
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
        await fsPromises.mkdir(configDir, { recursive: true });
      } catch (err) {
        // Directory might already exist
      }

      // Write the configuration to a JSON file
      const configPath = path.join(configDir, "wizard-config.json");
      await fsPromises.writeFile(
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

  // Update admin user password - improved implementation
  async updateAdminPassword(password) {
    try {
      // Store the password for later if we need it
      this.pendingAdminPassword = password;

      const adminUsername = "admin";
      this.safeLog(
        "info",
        `Finding admin user with username: ${adminUsername}`
      );

      // Get the admin user
      const user = await get_user({ username: adminUsername, cached: false });

      if (!user) {
        this.safeLog(
          "warn",
          `Admin user '${adminUsername}' not found, storing password for later application`
        );
        return false;
      }

      this.safeLog("info", `Found admin user with ID: ${user.id}`);

      // If DefaultUserService is available, try to use its methods first
      if (this.defaultUserService) {
        try {
          if (
            typeof this.defaultUserService.force_tmp_password_ === "function"
          ) {
            const newPwd =
              await this.defaultUserService.force_tmp_password_(user);
            this.safeLog(
              "info",
              "Updated password using DefaultUserService.force_tmp_password_"
            );

            // Verify it's not using the default password
            const bcrypt = require("bcrypt");
            const updatedUser = await get_user({
              username: adminUsername,
              cached: false,
            });
            const isCorrect = await bcrypt.compare(
              password,
              updatedUser.password
            );

            if (isCorrect) {
              await this.markPasswordSetByWizard();
              return true;
            } else {
              this.safeLog(
                "warn",
                "Password was not set correctly by DefaultUserService"
              );
            }
          }
        } catch (error) {
          this.safeLog(
            "warn",
            "Failed to use DefaultUserService methods",
            error
          );
        }
      }

      // Continue with the original implementation...
      // Hash the password with bcrypt
      const bcrypt = require("bcrypt");
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      this.safeLog("info", "Generated password hash, updating database...");

      // Get database access
      try {
        // First try to find a database service
        const dbService = await this.findDatabaseService();

        // Try multiple approaches to update the password
        let updated = false;

        // 1. Try using the user service if available
        try {
          const userService = this.services.get("user");
          if (userService) {
            // Check for various password update methods
            if (typeof userService.update_password === "function") {
              await userService.update_password(user.id, password);
              updated = true;
              this.safeLog(
                "info",
                "Password updated using userService.update_password"
              );
            } else if (typeof userService.change_password === "function") {
              await userService.change_password(user.id, password);
              updated = true;
              this.safeLog(
                "info",
                "Password updated using userService.change_password"
              );
            } else if (typeof userService.updatePassword === "function") {
              await userService.updatePassword(user.id, password);
              updated = true;
              this.safeLog(
                "info",
                "Password updated using userService.updatePassword"
              );
            } else if (typeof userService.setUserPassword === "function") {
              await userService.setUserPassword(user.id, password);
              updated = true;
              this.safeLog(
                "info",
                "Password updated using userService.setUserPassword"
              );
            }
          }
        } catch (userServiceError) {
          this.safeLog(
            "warn",
            "Failed to update password through user service, falling back to direct DB update",
            userServiceError
          );
        }

        // 2. If user service didn't work, use direct database access
        if (!updated && dbService) {
          if (dbService.knex) {
            // Using Knex
            const affectedRows = await dbService
              .knex("users")
              .where("id", user.id)
              .update({ password: passwordHash });

            if (affectedRows > 0) {
              updated = true;
              this.safeLog(
                "info",
                `Password updated using Knex, affected rows: ${affectedRows}`
              );
            }
          } else if (dbService.query) {
            // Using raw query
            const result = await dbService.query(
              "UPDATE users SET password = ? WHERE id = ?",
              [passwordHash, user.id]
            );

            if (result && (result.affectedRows > 0 || result.changes > 0)) {
              updated = true;
              this.safeLog(
                "info",
                `Password updated using raw query, result:`,
                result
              );
            }
          }
        }

        // 3. Fallback to finding the SQLite database file directly
        if (!updated) {
          const path = require("path");
          const fs = require("fs");
          const { Database } = require("better-sqlite3");

          // Try to locate the database file
          const possiblePaths = [
            path.join(process.cwd(), "volatile", "runtime", "puter.db"),
            path.join(process.cwd(), "runtime", "puter.db"),
            path.join(process.cwd(), "db", "puter.db"),
            "/var/puter/runtime/puter.db",
          ];

          for (const dbPath of possiblePaths) {
            try {
              if (fs.existsSync(dbPath)) {
                const db = new Database(dbPath);
                const stmt = db.prepare(
                  "UPDATE users SET password = ? WHERE id = ?"
                );
                const updateResult = stmt.run(passwordHash, user.id);

                if (updateResult.changes > 0) {
                  updated = true;
                  this.safeLog(
                    "info",
                    `Password updated using direct SQLite access, changes: ${updateResult.changes}`
                  );
                  break;
                }
              }
            } catch (directDbError) {
              this.safeLog(
                "error",
                `Failed to update password using direct access to ${dbPath}`,
                directDbError
              );
            }
          }
        }

        // 4. Verify the password was updated
        if (updated) {
          // Fetch the user again to verify the password change
          const updatedUser = await get_user({
            username: adminUsername,
            cached: false,
          });

          // Use bcrypt to compare the new password with the hash
          if (updatedUser && updatedUser.password) {
            const isPasswordCorrect = await bcrypt.compare(
              password,
              updatedUser.password
            );

            if (isPasswordCorrect) {
              this.safeLog(
                "info",
                "Verified password was successfully updated"
              );
              await this.markPasswordSetByWizard();
              return true;
            } else {
              this.safeLog(
                "warn",
                "Password update was reported successful but verification failed"
              );
              throw new Error("Password update could not be verified");
            }
          }
        } else {
          throw new Error("No method succeeded in updating the password");
        }

        return updated;
      } catch (dbError) {
        this.safeLog("error", "Database error during password update", dbError);
        throw new Error(`Database error: ${dbError.message}`);
      }
    } catch (error) {
      this.safeLog("error", "Failed to update admin password", error);
      throw error;
    }
  }

  async isPasswordSetByWizard() {
    try {
      const configDir = path.join(process.cwd(), "volatile", "config");
      const passwordFlagPath = path.join(configDir, "setup-password-set");

      // Check if the flag file exists
      return fs.existsSync(passwordFlagPath);
    } catch (error) {
      this.safeLog(
        "error",
        "Error checking if password was set by wizard",
        error
      );
      return false;
    }
  }

  async markPasswordSetByWizard() {
    try {
      const configDir = path.join(process.cwd(), "volatile", "config");
      const passwordFlagPath = path.join(configDir, "setup-password-set");

      // Make sure the config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Create the flag file
      fs.writeFileSync(passwordFlagPath, new Date().toISOString());
      this.safeLog("info", "Marked password as set by setup wizard");
      return true;
    } catch (error) {
      this.safeLog("error", "Error marking password as set by wizard", error);
      return false;
    }
  }

  /**
   * Returns the HTML for the setup wizard interface
   */
  getSetupWizardHTML(
    token = "",
    reconfigurationMode = false,
    currentConfig = {}
  ) {
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${reconfigurationMode ? "Puter Reconfiguration" : "Puter Setup Wizard"}</title>
            <style>
            ${this.getWizardStyles()}
            </style>
        </head>
        <body>
            <div class="setup-container">
                <div class="setup-header">
                    <img src="/assets/images/puter-logo.svg" alt="Puter Logo" class="logo">
                    <h1>${reconfigurationMode ? "Puter Reconfiguration" : "Puter Setup Wizard"}</h1>
                </div>
                
                <div class="setup-content">
                    <div class="setup-card">
                        ${
                          reconfigurationMode
                            ? '<div class="reconfiguration-warning">You are in admin reconfiguration mode. Changes you make will be applied immediately.</div>'
                            : ""
                        }
                        
                        <form id="setupForm">
                            <input type="hidden" id="setupToken" name="setupToken" value="${token}">
                            <input type="hidden" id="reconfigMode" name="reconfigMode" value="${reconfigurationMode ? "true" : "false"}">
                            
                            ${this.getWizardFormContent(currentConfig)}
                            
                            <div class="form-group">
                                <button type="submit" id="submit-btn" class="btn btn-primary">
                                    ${reconfigurationMode ? "Apply Changes" : "Complete Setup"}
                                </button>
                                ${
                                  reconfigurationMode
                                    ? '<button type="button" id="cancel-btn" class="btn btn-secondary">Cancel</button>'
                                    : ""
                                }
                            </div>
                        </form>
                        
                        <div id="feedback" class="feedback"></div>
                    </div>
                </div>
                
                <div class="setup-footer">
                    <p>&copy; ${new Date().getFullYear()} Puter Technologies Inc.</p>
                </div>
            </div>
            
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    const form = document.getElementById('setupForm');
                    const feedbackElement = document.getElementById('feedback');
                    const reconfigMode = document.getElementById('reconfigMode').value === 'true';
                    
                    ${
                      reconfigurationMode
                        ? `// Add cancel button functionality in reconfiguration mode
                      document.getElementById('cancel-btn').addEventListener('click', function() {
                          window.location.href = '/';
                      });
                      
                      // Add auth header to all requests in reconfiguration mode
                      const adminToken = sessionStorage.getItem('adminReconfigToken');
                      if (!adminToken) {
                          window.location.href = '/__admin/reconfigure-ui';
                      }`
                        : ""
                    }
                    
                    // Show feedback function
                    function showFeedback(message, isSuccess) {
                        feedbackElement.textContent = message;
                        feedbackElement.className = isSuccess ? 'feedback success' : 'feedback error';
                    }

                    // Form submission
                    form.addEventListener('submit', function(event) {
                        event.preventDefault();
                        
                        // Get form values
                        const subdomainBehavior = document.querySelector('input[name="subdomainBehavior"]:checked').value;
                        const domainType = document.querySelector('input[name="domainType"]:checked').value;
                        let domainName = '';
                        
                        if (domainType === 'domain') {
                            domainName = document.getElementById('domainName').value.trim();
                        }
                        
                        const adminPassword = document.getElementById('adminPassword').value.trim();
                        
                        // Validation
                        if (adminPassword.length < 8) {
                            showFeedback('Admin password must be at least 8 characters', false);
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
                            subdomainBehavior: subdomainBehavior,
                            domainName: domainName,
                            useNipIo: domainType === 'nipio',
                            adminPassword: adminPassword
                        };
                        
                        // Submit button loading state
                        const submitBtn = document.getElementById('submit-btn');
                        submitBtn.textContent = reconfigMode ? 'Applying...' : 'Setting up...';
                        submitBtn.disabled = true;
                        
                        // Submit configuration with appropriate endpoint and headers
                        const endpoint = reconfigMode ? '/__admin/reconfigure/submit' : '/__setup/configure';
                        const headers = {
                            'Content-Type': 'application/json'
                        };
                        
                        // Add token to headers depending on mode
                        if (reconfigMode) {
                            headers['Authorization'] = 'Bearer ' + adminToken;
                        } else if (token) {
                            headers['X-Setup-Token'] = token;
                        }
                        
                        fetch(reconfigMode ? endpoint : endpoint + (token ? '?token=' + token : ''), {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(formData)
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                showFeedback(reconfigMode ? 'Configuration updated successfully! Redirecting...' : 'Setup completed successfully! Redirecting...', true);
                                setTimeout(() => {
                                    // Use the current origin for both modes
                                    window.location.href = window.location.origin;
                                }, 2000);
                            } else {
                                showFeedback('Error: ' + (data.message || 'Unknown error'), false);
                                submitBtn.textContent = reconfigMode ? 'Apply Changes' : 'Complete Setup';
                                submitBtn.disabled = false;
                            }
                        })
                        .catch(error => {
                            showFeedback('Error: ' + error.message, false);
                            submitBtn.textContent = reconfigMode ? 'Apply Changes' : 'Complete Setup';
                            submitBtn.disabled = false;
                        });
                    });
                    
                    // Domain type change handler
                    const domainTypeInputs = document.querySelectorAll('input[name="domainType"]');
                    const domainNameField = document.getElementById('domainNameField');
                    
                    domainTypeInputs.forEach(input => {
                        input.addEventListener('change', function() {
                            domainNameField.style.display = this.value === 'domain' ? 'block' : 'none';
                        });
                    });
                    
                    // Initialize domain field visibility
                    const selectedDomainType = document.querySelector('input[name="domainType"]:checked');
                    if (selectedDomainType) {
                        domainNameField.style.display = selectedDomainType.value === 'domain' ? 'block' : 'none';
                    }
                });
            </script>
        </body>
        </html>
    `;

    return html;
  }

  /**
   * Get the CSS styles for the wizard UI
   */
  getWizardStyles() {
    return `
    /* Modern CSS for Setup Wizard */
    :root {
      --primary: #4361ee;
      --primary-hover: #3a56d4;
      --secondary: #6c757d;
      --secondary-hover: #5a6268;
      --success: #2ecc71;
      --warning: #f39c12;
      --danger: #e74c3c;
      --light: #f8f9fa;
      --dark: #343a40;
      --white: #ffffff;
      --border: #e0e0e0;
      --text: #333333;
      --text-light: #6c757d;
      --radius: 0.375rem;
      --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      --transition: all 0.3s ease;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
      background-color: #f5f7fa;
      color: var(--text);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    
    .setup-container {
      max-width: 640px;
      margin: 2rem auto;
      padding: 0 1.5rem;
    }
    
    .setup-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    
    .setup-header .logo {
      height: 50px;
      margin-bottom: 1rem;
    }
    
    .setup-header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--dark);
      margin-bottom: 0.5rem;
    }
    
    .setup-content {
      margin-bottom: 2rem;
    }
    
    .setup-card {
      background-color: var(--white);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 2rem;
    }
    
    .setup-footer {
      text-align: center;
      color: var(--text-light);
      font-size: 0.875rem;
    }
    
    .form-section {
      margin-bottom: 1.5rem;
    }
    
    .form-section h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
    
    .form-divider {
      height: 1px;
      background-color: var(--border);
      margin: 1.5rem 0;
    }
    
    .form-group {
      margin-bottom: 1rem;
    }
    
    .form-group label {
      display: block;
      font-weight: 500;
      margin-bottom: 0.5rem;
    }
    
    .input-field {
      width: 100%;
      padding: 0.75rem 1rem;
      font-size: 1rem;
      line-height: 1.5;
      color: var(--text);
      background-color: var(--white);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: var(--transition);
    }
    
    .input-field:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.25);
    }
    
    .form-hint {
      font-size: 0.875rem;
      color: var(--text-light);
      margin-top: 0.5rem;
    }
    
    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .radio-label {
      display: flex;
      align-items: center;
      padding: 0.75rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: var(--transition);
    }
    
    .radio-label:hover {
      background-color: #f9fafb;
    }
    
    .radio-label input[type="radio"] {
      margin-right: 0.75rem;
    }
    
    .radio-text {
      font-weight: 500;
    }
    
    .btn {
      display: inline-block;
      font-weight: 500;
      text-align: center;
      white-space: nowrap;
      vertical-align: middle;
      user-select: none;
      border: 1px solid transparent;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      line-height: 1.5;
      border-radius: var(--radius);
      transition: var(--transition);
      cursor: pointer;
    }
    
    .btn-primary {
      color: var(--white);
      background-color: var(--primary);
      border-color: var(--primary);
    }
    
    .btn-primary:hover {
      background-color: var(--primary-hover);
      border-color: var(--primary-hover);
    }
    
    .btn-secondary {
      color: var(--white);
      background-color: var(--secondary);
      border-color: var(--secondary);
      margin-left: 0.5rem;
    }
    
    .btn-secondary:hover {
      background-color: var(--secondary-hover);
      border-color: var(--secondary-hover);
    }
    
    .btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    
    .feedback {
      margin-top: 1rem;
      padding: 1rem;
      border-radius: var(--radius);
      font-size: 0.875rem;
      display: none;
    }
    
    .feedback.success {
      display: block;
      color: #155724;
      background-color: #d4edda;
      border: 1px solid #c3e6cb;
    }
    
    .feedback.error {
      display: block;
      color: #721c24;
      background-color: #f8d7da;
      border: 1px solid #f5c6cb;
    }
    
    .form-helper {
      margin-top: 0.75rem;
      font-size: 0.875rem;
    }
    
    .form-helper.hidden {
      display: none;
    }
    
    .form-helper.visible {
      display: block;
    }
    
    .warning-message {
      padding: 0.75rem;
      background-color: #fff8e5;
      border: 1px solid #ffe9a8;
      border-radius: var(--radius);
      display: flex;
      align-items: flex-start;
    }
    
    .warning-icon {
      margin-right: 0.5rem;
      font-size: 1rem;
    }
    
    .info-message {
      padding: 0.75rem;
      background-color: #e6f7ff;
      border: 1px solid #b8e2fd;
      border-radius: var(--radius);
      display: flex;
      align-items: flex-start;
    }
    
    .info-icon {
      margin-right: 0.5rem;
      font-size: 1rem;
    }
    
    .reconfiguration-warning {
      padding: 0.75rem;
      margin-bottom: 1.5rem;
      background-color: #ffedde;
      border: 1px solid #ffd0a8;
      border-radius: var(--radius);
      color: #8a4500;
      font-weight: 500;
    }
    
    @media (min-width: 640px) {
      .radio-group {
        flex-direction: row;
      }
      
      .radio-label {
        flex: 1;
      }
    }
    `;
  }

  // Extract form content to a separate method for better maintainability
  getWizardFormContent(currentConfig = {}) {
    // Get current values or defaults
    const subdomainBehavior =
      currentConfig.experimental_no_subdomain === true ? "disabled" : "enabled";
    const useNipIo = currentConfig.useNipIo === true;
    const domainName = currentConfig.domain || "";

    return `
    <div class="form-section">
        <h2>Subdomain Configuration</h2>
        <div class="radio-group">
            <label class="radio-label">
                <input type="radio" name="subdomainBehavior" value="enabled" ${subdomainBehavior === "enabled" ? "checked" : ""}>
                <span class="radio-text">Enabled (Recommended)</span>
            </label>
            <label class="radio-label">
                <input type="radio" name="subdomainBehavior" value="disabled" ${subdomainBehavior === "disabled" ? "checked" : ""}>
                <span class="radio-text">Disabled</span>
            </label>
        </div>
        
        <div class="form-helper ${subdomainBehavior === "disabled" ? "visible" : "hidden"}" id="subdomain-warning">
            <div class="warning-message">
                <span class="warning-icon">⚠️</span>
                <span>Disabling subdomains makes your deployment less secure. Only use this option if your hosting environment does not support subdomains.</span>
            </div>
        </div>
    </div>
    
    <div class="form-divider"></div>
    
    <div class="form-section">
        <h2>Domain Configuration</h2>
        <div class="radio-group">
            <label class="radio-label">
                <input type="radio" name="domainType" value="domain" ${!useNipIo ? "checked" : ""}>
                <span class="radio-text">Custom Domain</span>
            </label>
            <label class="radio-label">
                <input type="radio" name="domainType" value="nipio" ${useNipIo ? "checked" : ""}>
                <span class="radio-text">Use nip.io (IP-based)</span>
            </label>
        </div>
        
        <div class="form-group" id="domainNameField" style="display: ${!useNipIo ? "block" : "none"}">
            <label for="domainName">Domain Name</label>
            <input type="text" id="domainName" class="input-field" placeholder="e.g., yourdomain.com" value="${domainName}">
        </div>
        
        <div class="form-helper" id="nip-io-info" style="display: ${useNipIo ? "block" : "none"}">
            <div class="info-message">
                <span class="info-icon">ℹ️</span>
                <span>Using nip.io will create a domain based on your server's IP address.</span>
            </div>
        </div>
    </div>
    
    <div class="form-divider"></div>
    
    <div class="form-section">
        <h2>Admin Password</h2>
        <div class="form-group">
            <label for="adminPassword">Password</label>
            <input type="password" id="adminPassword" class="input-field" placeholder="Enter admin password">
            <p class="form-hint">Leave blank to keep the current password</p>
        </div>
    </div>
    `;
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
            // Wait for the DefaultUserService to create the admin user
            this.safeLog("info", "Waiting for admin user to be available...");

            // Retry mechanism - wait for the admin user to be available
            let adminUser = null;
            let attempts = 0;
            const maxAttempts = 10;

            while (!adminUser && attempts < maxAttempts) {
              try {
                adminUser = await get_user({
                  username: "admin",
                  cached: false,
                });
                if (adminUser) {
                  this.safeLog(
                    "info",
                    "Admin user found, proceeding with password update"
                  );
                } else {
                  this.safeLog(
                    "info",
                    `Admin user not found, retrying (${attempts + 1}/${maxAttempts})`
                  );
                  // Wait a bit before trying again
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              } catch (err) {
                this.safeLog("warn", "Error fetching admin user", err);
              }
              attempts++;
            }

            if (!adminUser) {
              throw new Error(
                "Admin user not available after multiple attempts"
              );
            }

            // Now update the password
            const passwordUpdateResult = await this.updateAdminPassword(
              data.adminPassword
            );

            if (passwordUpdateResult === true) {
              this.safeLog("info", "Admin password updated successfully");
            } else {
              throw new Error("Password update did not complete successfully");
            }

            // Explicitly mark the password as set by the wizard
            await this.markPasswordSetByWizard();
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
  async processConfigSteps(data, req, isReconfigMode = false) {
    let config = {};

    // Process each step in order
    for (const step of this.configSteps) {
      try {
        this.safeLog("info", `Processing configuration step: ${step.id}`);

        // Skip admin password update in reconfiguration mode if password is empty
        if (
          isReconfigMode &&
          step.id === "adminPassword" &&
          (!data.adminPassword || data.adminPassword.trim() === "")
        ) {
          this.safeLog(
            "info",
            "Admin password empty in reconfiguration mode, skipping password update"
          );
          continue;
        }

        const stepConfig = await step.process.call(this, data, req);
        config = { ...config, ...stepConfig };
      } catch (error) {
        this.safeLog("error", `Error processing step ${step.id}`, error);
        throw error;
      }
    }

    return config;
  }

  /**
   * Reset the setup configuration
   * This removes the setup-completed file and generates a new setup token
   */
  async resetConfiguration() {
    try {
      const configDir = path.join(process.cwd(), "config");
      const setupCompletedPath = path.join(configDir, "setup-completed");
      const passwordFlagPath = path.join(configDir, "setup-password-set");
      const volatileConfigDir = path.join(process.cwd(), "volatile", "config");
      const volatilePasswordFlagPath = path.join(
        volatileConfigDir,
        "setup-password-set"
      );

      // Remove the setup-completed file
      try {
        await fsPromises.unlink(setupCompletedPath);
        this.log.info("Removed setup-completed marker for configuration reset");
      } catch (err) {
        this.log.warn("Failed to remove setup-completed file", err);
      }

      // Remove the password set flag if it exists
      try {
        if (fs.existsSync(passwordFlagPath)) {
          await fsPromises.unlink(passwordFlagPath);
          this.log.info("Removed password-set flag for configuration reset");
        }
      } catch (err) {
        this.log.warn("Failed to remove password-set flag", err);
      }

      // Also check the volatile config location
      try {
        if (fs.existsSync(volatilePasswordFlagPath)) {
          await fsPromises.unlink(volatilePasswordFlagPath);
          this.log.info(
            "Removed volatile password-set flag for configuration reset"
          );
        }
      } catch (err) {
        this.log.warn("Failed to remove volatile password-set flag", err);
      }

      // Generate a new setup token
      const crypto = require("crypto");
      const setupToken = crypto.randomBytes(32).toString("hex");

      try {
        const tokenPath = path.join(configDir, "setup-token");
        await fsPromises.writeFile(tokenPath, setupToken, "utf8");
        this.log.info("Generated new setup token for configuration reset");
      } catch (err) {
        this.log.error("Failed to generate new setup token", err);
      }

      return true;
    } catch (error) {
      this.log.error("Failed to reset configuration", error);
      throw error;
    }
  }

  /**
   * Registers the DefaultUserService with this service
   * This allows for better coordination during admin user creation and password updates
   * @param {Object} defaultUserService The DefaultUserService instance
   */
  registerDefaultUserService(defaultUserService) {
    this.defaultUserService = defaultUserService;
    this.safeLog("info", "DefaultUserService registered with SetupService");

    // If we have a pending admin password update, apply it now
    if (this.pendingAdminPassword) {
      this.safeLog("info", "Applying pending admin password update");

      // Use setTimeout to allow the DefaultUserService to fully initialize
      setTimeout(async () => {
        try {
          await this.updateAdminPassword(this.pendingAdminPassword);
          this.safeLog("info", "Applied pending admin password update");
          this.pendingAdminPassword = null;
        } catch (error) {
          this.safeLog(
            "error",
            "Failed to apply pending admin password update",
            error
          );
        }
      }, 2000); // Wait 2 seconds to ensure user is created
    }
  }

  /**
   * Install routes for admin reconfiguration access
   * This allows admin users to return to the setup wizard after initial setup
   */
  _installAdminReconfigEndpoints() {
    // Get app instance
    const app = this.app;
    if (!app) return;

    // Admin reconfiguration page
    Endpoint({
      route: "/__admin/reconfigure",
      methods: ["GET"],
      handler: async (req, res) => {
        try {
          // Check if the user is authenticated as admin
          const adminUsername = "admin";
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
              success: false,
              message: "Admin authentication required",
            });
          }

          const token = authHeader.split(" ")[1];

          // Verify the admin credentials
          const isAdmin = await this._verifyAdminCredentials(token);
          if (!isAdmin) {
            return res.status(403).json({
              success: false,
              message: "Admin authentication failed",
            });
          }

          // Load current configuration
          const currentConfig = await this._loadCurrentConfig();

          // Generate the setup wizard HTML with reconfiguration mode
          res.send(this.getSetupWizardHTML("", true, currentConfig));
        } catch (error) {
          this.safeLog("error", "Error in admin reconfiguration page", error);
          res.status(500).json({
            success: false,
            message: "An error occurred",
            error: error.message,
          });
        }
      },
    }).attach(app);

    // Admin reconfiguration submit endpoint
    Endpoint({
      route: "/__admin/reconfigure/submit",
      methods: ["POST"],
      handler: async (req, res) => {
        try {
          // Check if the user is authenticated as admin
          const adminUsername = "admin";
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
              success: false,
              message: "Admin authentication required",
            });
          }

          const token = authHeader.split(" ")[1];

          // Verify the admin credentials
          const isAdmin = await this._verifyAdminCredentials(token);
          if (!isAdmin) {
            return res.status(403).json({
              success: false,
              message: "Admin authentication failed",
            });
          }

          // Process configuration in reconfiguration mode
          const config = await this.processConfigSteps(req.body, req, true);

          // Apply configuration
          await this.updateConfig(config);

          // Don't mark setup as completed again - it's already complete
          // Just return success
          return res.json({
            success: true,
            message: "Configuration updated successfully",
          });
        } catch (error) {
          this.safeLog("error", "Error in admin reconfiguration submit", error);
          res.status(500).json({
            success: false,
            message: "An error occurred",
            error: error.message,
          });
        }
      },
    }).attach(app);

    // Generate admin access token endpoint
    Endpoint({
      route: "/__admin/reconfigure/token",
      methods: ["POST"],
      handler: async (req, res) => {
        try {
          // Verify admin password
          const { password } = req.body;
          if (!password) {
            return res.status(400).json({
              success: false,
              message: "Admin password is required",
            });
          }

          // Get admin user
          const adminUser = await get_user({
            username: "admin",
            cached: false,
          });
          if (!adminUser) {
            return res.status(404).json({
              success: false,
              message: "Admin user not found",
            });
          }

          // Verify password
          const bcrypt = require("bcrypt");
          const passwordCorrect = await bcrypt.compare(
            password,
            adminUser.password
          );
          if (!passwordCorrect) {
            return res.status(401).json({
              success: false,
              message: "Invalid admin password",
            });
          }

          // Generate token
          const crypto = require("crypto");
          const adminToken = crypto.randomBytes(32).toString("hex");

          // Store token (temporarily) - in a real implementation, you'd use a proper session mechanism
          this._storeAdminToken(adminToken, adminUser.id);

          // Return the token
          return res.json({
            success: true,
            token: adminToken,
          });
        } catch (error) {
          this.safeLog("error", "Error generating admin token", error);
          res.status(500).json({
            success: false,
            message: "An error occurred",
            error: error.message,
          });
        }
      },
    }).attach(app);

    // Admin reconfiguration UI access endpoint
    Endpoint({
      route: "/__admin/reconfigure-ui",
      methods: ["GET"],
      handler: async (req, res) => {
        res.send(this.getAdminReconfigUI());
      },
    }).attach(app);
  }

  /**
   * Store admin token temporarily
   * In a production environment, this should use a more robust session mechanism
   */
  _storeAdminToken(token, userId) {
    // Initialize token store if not exists
    if (!this._adminTokens) {
      this._adminTokens = new Map();
    }

    // Store token with expiration (30 minutes)
    this._adminTokens.set(token, {
      userId,
      expires: Date.now() + 30 * 60 * 1000, // 30 minutes
    });

    // Cleanup expired tokens periodically
    if (!this._tokenCleanupInterval) {
      this._tokenCleanupInterval = setInterval(() => {
        if (!this._adminTokens) return;

        const now = Date.now();
        for (const [token, data] of this._adminTokens.entries()) {
          if (data.expires < now) {
            this._adminTokens.delete(token);
          }
        }
      }, 60 * 1000); // Cleanup every minute
    }
  }

  /**
   * Verify admin credentials using the token
   */
  async _verifyAdminCredentials(token) {
    if (!this._adminTokens) return false;

    // Check if token exists and is valid
    const tokenData = this._adminTokens.get(token);
    if (!tokenData) return false;

    // Check if token is expired
    if (tokenData.expires < Date.now()) {
      this._adminTokens.delete(token);
      return false;
    }

    // Check if the user is admin
    const user = await get_user({ id: tokenData.userId, cached: false });
    return user && user.username === "admin";
  }

  /**
   * Load the current configuration
   */
  async _loadCurrentConfig() {
    try {
      // Load from configuration file
      const configDir = path.join(process.cwd(), "config");
      const configPath = path.join(configDir, "wizard-config.json");

      let config = {};
      try {
        if (fs.existsSync(configPath)) {
          const configData = await fsPromises.readFile(configPath, "utf8");
          config = JSON.parse(configData);
        }
      } catch (err) {
        this.safeLog("warn", "Failed to load existing configuration", err);
      }

      return config;
    } catch (error) {
      this.safeLog("error", "Error loading current configuration", error);
      return {};
    }
  }

  /**
   * Get admin reconfiguration UI
   * This is a simple page with a form to enter admin password and access the reconfiguration
   */
  getAdminReconfigUI() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Puter Admin Reconfiguration</title>
        <style>
        ${this.getWizardStyles()}
        </style>
    </head>
    <body>
        <div class="setup-container">
            <div class="setup-header">
                <img src="/assets/images/puter-logo.svg" alt="Puter Logo" class="logo">
                <h1>Admin Reconfiguration</h1>
            </div>
            
            <div class="setup-content">
                <div class="setup-card">
                    <h2>Access Setup Wizard</h2>
                    <p>Enter your admin password to access the setup wizard and reconfigure your Puter instance.</p>
                    
                    <div class="form-group">
                        <label for="adminPassword">Admin Password</label>
                        <input type="password" id="adminPassword" class="input-field" placeholder="Enter admin password">
                    </div>
                    
                    <div class="form-group">
                        <button id="accessBtn" class="btn btn-primary">Access Reconfiguration</button>
                    </div>
                    
                    <div id="feedback" class="feedback"></div>
                </div>
            </div>
            
            <div class="setup-footer">
                <p>&copy; ${new Date().getFullYear()} Puter Technologies Inc.</p>
            </div>
        </div>
        
        <script>
        document.addEventListener('DOMContentLoaded', function() {
            const accessBtn = document.getElementById('accessBtn');
            const adminPasswordInput = document.getElementById('adminPassword');
            const feedbackEl = document.getElementById('feedback');
            
            function showFeedback(message, isSuccess) {
                feedbackEl.textContent = message;
                feedbackEl.className = isSuccess ? 'feedback success' : 'feedback error';
            }
            
            accessBtn.addEventListener('click', async function() {
                const adminPassword = adminPasswordInput.value.trim();
                
                if (!adminPassword) {
                    showFeedback('Please enter your admin password', false);
                    return;
                }
                
                // Disable the button and show loading state
                accessBtn.disabled = true;
                accessBtn.textContent = 'Verifying...';
                
                try {
                    // Request admin token
                    const tokenResponse = await fetch('/__admin/reconfigure/token', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ password: adminPassword })
                    });
                    
                    const tokenData = await tokenResponse.json();
                    
                    if (tokenData.success) {
                        // Store token in session storage
                        sessionStorage.setItem('adminReconfigToken', tokenData.token);
                        
                        // Redirect to reconfiguration page
                        showFeedback('Access granted! Redirecting...', true);
                        setTimeout(() => {
                            window.location.href = '/__admin/reconfigure';
                        }, 1000);
                    } else {
                        showFeedback('Error: ' + (tokenData.message || 'Authentication failed'), false);
                        accessBtn.disabled = false;
                        accessBtn.textContent = 'Access Reconfiguration';
                    }
                } catch (error) {
                    showFeedback('Error: ' + error.message, false);
                    accessBtn.disabled = false;
                    accessBtn.textContent = 'Access Reconfiguration';
                }
            });
            
            // Allow pressing Enter to submit
            adminPasswordInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    accessBtn.click();
                }
            });
        });
        </script>
    </body>
    </html>
    `;
  }

  /**
   * Injects admin menu with reconfiguration link
   * This method adds a middleware that injects JavaScript to create an admin menu
   */
  _injectAdminMenu() {
    // Get app instance
    const app = this.app;
    if (!app) return;

    // Create a direct access endpoint that simply redirects to the reconfiguration UI
    app.get("/__admin", (req, res) => {
      res.redirect("/__admin/reconfigure-ui");
    });

    // Middleware to inject admin menu
    app.use((req, res, next) => {
      // Skip for API routes, assets, and setup routes
      if (
        req.path.startsWith("/api/") ||
        req.path.startsWith("/assets/") ||
        req.path.startsWith("/__setup") ||
        req.path.startsWith("/__admin/")
      ) {
        return next();
      }

      // Store the original send method
      const originalSend = res.send;

      // Override the send method
      res.send = function (body) {
        // Only process HTML responses
        if (
          typeof body === "string" &&
          (body.includes("</body>") || body.includes("</html>")) &&
          (!res.getHeader("Content-Type") ||
            res.getHeader("Content-Type").includes("text/html"))
        ) {
          // Inject the admin menu script with more reliable user detection
          const adminMenuScript = `
          <script>
          // Wait for DOM to be fully loaded
          (function() {
            // Function to add the admin menu
            function addAdminMenu() {
              console.log('Checking for admin user...');
              
              // More comprehensive check for admin user
              function isAdminUser() {
                // 1. Check URL parameters (for testing)
                if (new URLSearchParams(window.location.search).get('admin') === 'true') {
                  return true;
                }
                
                // 2. Check for username elements in the page
                const possibleSelectors = [
                  '.username', '.user-name', '.account-name', '.user-info', 
                  '[data-username]', '[data-user]', '.profile-name',
                  '.user-profile', '.account-info'
                ];
                
                for (const selector of possibleSelectors) {
                  const elements = document.querySelectorAll(selector);
                  for (const el of elements) {
                    const text = el.textContent || el.innerText || '';
                    if (text.trim().toLowerCase() === 'admin') {
                      return true;
                    }
                    
                    // Check attributes
                    if (el.getAttribute('data-username') === 'admin' || 
                        el.getAttribute('data-user') === 'admin') {
                      return true;
                    }
                  }
                }
                
                // 3. Check cookies or localStorage if available
                try {
                  if (localStorage.getItem('username') === 'admin' || 
                      document.cookie.includes('username=admin')) {
                    return true;
                  }
                } catch (e) {
                  // Ignore errors accessing localStorage
                }
                
                // 4. As a fallback, check if the page content contains admin references
                const pageContent = document.body.textContent || '';
                if (pageContent.includes('Logged in as admin') || 
                    pageContent.includes('User: admin')) {
                  return true;
                }
                
                // Get the URL pathname
                const pathname = window.location.pathname;
                
                // 5. For testing purposes, always show admin button in development
                if (window.location.hostname.includes('localhost') || 
                    window.location.hostname.includes('127.0.0.1')) {
                  console.log('Development environment detected, showing admin button');
                  return true;
                }
                
                return false;
              }
              
              // Check if current user is admin
              if (isAdminUser()) {
                console.log('Admin user detected, adding admin menu button');
                
                // Create the admin menu element
                const adminMenu = document.createElement('div');
                adminMenu.className = 'puter-admin-menu';
                adminMenu.innerHTML = \`
                  <button class="puter-admin-button">Admin</button>
                  <div class="puter-admin-dropdown">
                    <a href="/__admin/reconfigure-ui" class="puter-admin-link">Reconfigure Setup</a>
                  </div>
                \`;
                
                // Add styles with higher specificity to avoid conflicts
                const styles = document.createElement('style');
                styles.textContent = \`
                  body .puter-admin-menu {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 9999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  }
                  body .puter-admin-menu * {
                    box-sizing: border-box;
                  }
                  body .puter-admin-button {
                    background: #4361ee;
                    color: white !important;
                    border: none;
                    border-radius: 4px;
                    padding: 8px 12px;
                    font-weight: 500;
                    cursor: pointer;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    font-size: 14px;
                    line-height: 1.5;
                  }
                  body .puter-admin-dropdown {
                    position: absolute;
                    bottom: 100%;
                    right: 0;
                    background: white;
                    border-radius: 4px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    margin-bottom: 8px;
                    display: none;
                    min-width: 180px;
                  }
                  body .puter-admin-menu:hover .puter-admin-dropdown {
                    display: block;
                  }
                  body .puter-admin-link {
                    display: block;
                    padding: 8px 16px;
                    color: #333 !important;
                    text-decoration: none !important;
                    white-space: nowrap;
                    font-size: 14px;
                  }
                  body .puter-admin-link:hover {
                    background: #f5f5f5;
                  }
                \`;
                
                // Add to document
                document.head.appendChild(styles);
                document.body.appendChild(adminMenu);
                
                console.log('Admin menu added to page');
              } else {
                console.log('Not an admin user, admin menu not added');
              }
            }
            
            // Function to run when DOM is loaded
            function onDOMReady() {
              addAdminMenu();
            }
            
            // If DOM already loaded, run now, otherwise add event listener
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
              setTimeout(onDOMReady, 100);
            } else {
              document.addEventListener('DOMContentLoaded', onDOMReady);
            }
            
            // Also try again after a short delay to catch dynamic content
            setTimeout(addAdminMenu, 1000);
            
            // Also add a simpler text link at the very end of the page as a fallback
            setTimeout(function() {
              const linkContainer = document.createElement('div');
              linkContainer.style.textAlign = 'center';
              linkContainer.style.padding = '20px';
              linkContainer.style.fontSize = '12px';
              linkContainer.style.color = '#999';
              linkContainer.innerHTML = '<a href="/__admin" style="color: #666; text-decoration: underline;">Admin Settings</a>';
              document.body.appendChild(linkContainer);
            }, 500);
          })();
          </script>
          `;

          // Insert script right before the closing body tag
          if (body.includes("</body>")) {
            body = body.replace("</body>", adminMenuScript + "</body>");
          } else if (body.includes("</html>")) {
            body = body.replace("</html>", adminMenuScript + "</html>");
          } else {
            // If no closing tags, append to the end
            body += adminMenuScript;
          }
        }

        // Call the original send method
        return originalSend.call(this, body);
      };

      next();
    });

    this.log.info("Admin menu injection middleware installed");
  }

  /**
   * Hook that runs when the webserver is ready
   */
  async ["__on_ready.webserver"]() {
    // Inject admin menu into the UI
    this._injectAdminMenu();

    this.log.info("Setup Service ready, admin menu injected");

    // Shows a notification to the admin user about the reconfiguration feature
    this._showAdminNotification();
  }

  /**
   * Shows a notification to the admin user about the reconfiguration feature
   * This is called when the webserver is ready
   */
  _showAdminNotification() {
    try {
      // Add a console log message for admins
      console.log(
        "============================================================"
      );
      console.log("💡 Admin Reconfiguration Feature Available 💡");
      console.log("Access the setup wizard reconfiguration at /__admin");
      console.log(
        "(The admin button should appear in the bottom-right corner)"
      );
      console.log(
        "============================================================"
      );

      // Try to find the dev-console service for better visibility
      const devConsole = this.services.get("dev-console");
      if (devConsole && typeof devConsole.add_widget === "function") {
        // Create a widget for the admin notification
        const adminReconfigWidget = () => {
          return [
            "Admin Reconfiguration Feature Available",
            "Access at: /__admin",
            "",
          ];
        };

        // Add widget to dev console
        devConsole.add_widget(adminReconfigWidget);
      }
    } catch (error) {
      this.safeLog("error", "Failed to show admin notification", error);
    }
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
