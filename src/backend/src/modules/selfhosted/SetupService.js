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
                        
                        // Submit button loading state
                        const submitBtn = document.getElementById('submit-btn');
                        submitBtn.textContent = 'Setting up...';
                        submitBtn.disabled = true;
                        
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
