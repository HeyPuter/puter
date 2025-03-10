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
    this.setupCompleted = await this.isSetupCompleted();

    if (!this.setupCompleted) {
      this.log.info("Setup not completed, wizard will be displayed");
    } else {
      this.log.info("Setup already completed, skipping wizard");
    }
  }

  /**
   * Check if the setup wizard has already been completed
   */
  async isSetupCompleted() {
    try {
      // Check if a setup completion marker exists
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

      // Create config directory if it doesn't exist
      try {
        await fs.mkdir(configDir, { recursive: true });
      } catch (err) {
        // Directory might already exist, which is fine
      }

      // Write an empty file to mark setup as completed
      await fs.writeFile(path.join(configDir, "setup-completed"), "", "utf8");
      this.setupCompleted = true;
      this.log.info("Setup marked as completed");
    } catch (error) {
      this.log.error("Failed to mark setup as completed", error);
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
    this.log.info("Installing setup wizard routes");

    // Route to check setup status
    Endpoint({
      route: "/__setup/status",
      methods: ["GET"],
      handler: async (req, res) => {
        res.json({
          setupCompleted: this.setupCompleted,
        });
      },
    }).attach(app);

    // Route to render setup wizard HTML page
    Endpoint({
      route: "/__setup",
      methods: ["GET"],
      handler: async (req, res) => {
        if (this.setupCompleted) {
          return res.redirect("/");
        }

        // Serve the setup wizard HTML page
        res.send(this.getSetupWizardHTML());
      },
    }).attach(app);

    // API endpoint to save configuration
    Endpoint({
      route: "/__setup/configure",
      methods: ["POST"],
      handler: async (req, res) => {
        try {
          const { subdomainBehavior, domainName, useNipIo, adminPassword } =
            req.body;

          // Apply configurations
          await this.updateConfig({
            experimental_no_subdomain: subdomainBehavior === "disabled",
            domain: useNipIo
              ? `${req.ip.replace(/\./g, "-")}.nip.io`
              : domainName,
          });

          // Update admin password if provided
          if (adminPassword && adminPassword.trim()) {
            await this.updateAdminPassword(adminPassword);
          }

          // Mark setup as completed
          await this.markSetupCompleted();

          res.json({ success: true, message: "Setup completed successfully" });
        } catch (error) {
          this.log.error("Setup configuration failed", error);
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
        // Skip for API and asset requests
        if (
          req.path.startsWith("/__setup") ||
          req.path.startsWith("/api/") ||
          req.path.startsWith("/assets/")
        ) {
          return next();
        }

        // Redirect to setup wizard
        res.redirect("/__setup");
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

      this.log.info("Configuration updated", newConfig);
      return true;
    } catch (error) {
      this.log.error("Failed to update configuration", error);
      throw error;
    }
  }

  /**
   * Updates the admin user's password
   * Uses direct database access instead of relying on DefaultUserService
   */
  async updateAdminPassword(password) {
    try {
      // Get the admin user directly without using DefaultUserService
      const adminUsername = "admin"; // Default admin username
      const user = await get_user({ username: adminUsername, cached: false });

      if (!user) {
        throw new Error("Admin user not found");
      }

      // Get user service to update password
      const userService = this.services.get("user");
      await userService.setUserPassword(user.id, password);

      this.log.info("Admin password updated");
      return true;
    } catch (error) {
      this.log.error("Failed to update admin password", error);
      throw error;
    }
  }

  /**
   * Returns the HTML for the setup wizard interface
   */
  getSetupWizardHTML() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Puter Setup Wizard</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background-color: #f5f7fa;
                    margin: 0;
                    padding: 0;
                    color: #333;
                }
                .container {
                    max-width: 800px;
                    margin: 50px auto;
                    padding: 30px;
                    background-color: white;
                    border-radius: 10px;
                    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
                }
                h1 {
                    text-align: center;
                    color: #2563eb;
                    margin-bottom: 30px;
                }
                .setup-form {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }
                .form-section {
                    border: 1px solid #e5e7eb;
                    padding: 20px;
                    border-radius: 8px;
                    background-color: #f9fafb;
                }
                .form-section h2 {
                    margin-top: 0;
                    font-size: 1.2rem;
                    color: #4b5563;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: 500;
                }
                input[type="text"],
                input[type="password"] {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #d1d5db;
                    border-radius: 5px;
                    font-size: 16px;
                }
                .radio-group {
                    display: flex;
                    gap: 15px;
                    margin-top: 10px;
                }
                .radio-option {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .warning {
                    background-color: #fff7ed;
                    border-left: 4px solid #f97316;
                    padding: 10px;
                    margin-top: 10px;
                    font-size: 14px;
                    color: #9a3412;
                }
                button {
                    background-color: #2563eb;
                    color: white;
                    border: none;
                    padding: 12px 20px;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 20px;
                    transition: background-color 0.2s;
                }
                button:hover {
                    background-color: #1d4ed8;
                }
                .conditional {
                    margin-top: 15px;
                    padding-left: 25px;
                }
                #setup-feedback {
                    margin-top: 20px;
                    padding: 15px;
                    border-radius: 5px;
                    display: none;
                }
                .success {
                    background-color: #ecfdf5;
                    color: #065f46;
                    border: 1px solid #a7f3d0;
                }
                .error {
                    background-color: #fef2f2;
                    color: #b91c1c;
                    border: 1px solid #fecaca;
                }
                .logo {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .logo img {
                    height: 80px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">
                    <img src="/assets/img/logo.svg" alt="Puter Logo">
                </div>
                <h1>Welcome to Puter</h1>
                <p>This setup wizard will help you configure your Puter instance. These settings can be modified later by editing your configuration files.</p>
                
                <form id="setup-form" class="setup-form">
                    <div class="form-section">
                        <h2>Subdomain Configuration</h2>
                        <div class="form-group">
                            <label>Subdomain Behavior:</label>
                            <div class="radio-group">
                                <div class="radio-option">
                                    <input type="radio" id="subdomain-enabled" name="subdomainBehavior" value="enabled" checked>
                                    <label for="subdomain-enabled">Enabled (Recommended)</label>
                                </div>
                                <div class="radio-option">
                                    <input type="radio" id="subdomain-disabled" name="subdomainBehavior" value="disabled">
                                    <label for="subdomain-disabled">Disabled</label>
                                </div>
                            </div>
                            <div id="subdomain-warning" class="warning" style="display: none;">
                                Warning: Disabling subdomains makes your deployment less secure. Only use this option if your hosting does not support subdomains.
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h2>Domain Configuration</h2>
                        <div class="form-group">
                            <div class="radio-group">
                                <div class="radio-option">
                                    <input type="radio" id="use-domain" name="domainType" value="domain" checked>
                                    <label for="use-domain">Use Domain Name</label>
                                </div>
                                <div class="radio-option">
                                    <input type="radio" id="use-nipio" name="domainType" value="nipio">
                                    <label for="use-nipio">Use nip.io (IP-based)</label>
                                </div>
                            </div>
                            
                            <div id="domain-input" class="conditional">
                                <label for="domainName">Domain Name:</label>
                                <input type="text" id="domainName" name="domainName" placeholder="e.g., yourdomain.com">
                            </div>
                            
                            <div id="nipio-info" class="conditional" style="display: none;">
                                <p>Using nip.io will create a domain based on your server's IP address.</p>
                                <p>Your Puter instance will be accessible at: <span id="nipio-domain">--.--.--.---.nip.io</span></p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h2>Admin User Password</h2>
                        <div class="form-group">
                            <label for="adminPassword">Set Admin Password:</label>
                            <input type="password" id="adminPassword" name="adminPassword" placeholder="Enter a secure password">
                        </div>
                        <div class="form-group">
                            <label for="confirmPassword">Confirm Password:</label>
                            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Confirm your password">
                        </div>
                    </div>
                    
                    <button type="submit" id="submit-btn">Complete Setup</button>
                </form>
                
                <div id="setup-feedback"></div>
            </div>
            
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    // Get user's IP for nip.io domain
                    fetch('/__setup/status')
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
                        
                        // Prepare data for submission
                        const formData = {
                            subdomainBehavior: document.querySelector('input[name="subdomainBehavior"]:checked').value,
                            domainName: domainName,
                            useNipIo: domainType === 'nipio',
                            adminPassword: adminPassword
                        };
                        
                        // Submit configuration
                        fetch('/__setup/configure', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
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
                            }
                        })
                        .catch(error => {
                            showFeedback('Error: ' + error.message, false);
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
