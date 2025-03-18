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
const { QuickMkdir } = require("../../filesystem/hl_operations/hl_mkdir");
const { HLWrite } = require("../../filesystem/hl_operations/hl_write");
const { NodePathSelector } = require("../../filesystem/node/selectors");
const { surrounding_box } = require("../../fun/dev-console-ui-utils");
const { get_user, invalidate_cached_user } = require("../../helpers");
const { Context } = require("../../util/context");
const { asyncSafeSetInterval } = require("@heyputer/putility").libs.promise;
const { buffer_to_stream } = require("../../util/streamutil");
const BaseService = require("../../services/BaseService");
const { Actor, UserActorType } = require("../../services/auth/Actor");
const { DB_WRITE } = require("../../services/database/consts");
const { quot } = require("@heyputer/putility").libs.string;

const USERNAME = "admin";

const DEFAULT_FILES = {
  ".policy": {
    "drivers.json": JSON.stringify(
      {
        temp: {
          kv: {
            "rate-limit": {
              max: 1000,
              period: 30000,
            },
          },
          es: {
            "rate-limit": {
              max: 1000,
              period: 30000,
            },
          },
        },
        user: {
          kv: {
            "rate-limit": {
              max: 3000,
              period: 30000,
            },
          },
          es: {
            "rate-limit": {
              max: 3000,
              period: 30000,
            },
          },
        },
      },
      undefined,
      "    "
    ),
  },
};

class DefaultUserService extends BaseService {
  static MODULES = {
    bcrypt: require("bcrypt"),
    uuidv4: require("uuid").v4,
    has: ["database"],
  };

  async _init() {
    try {
      this._register_commands(this.services.get("commands"));

      // Defer user operations to a later stage to ensure services are fully initialized
      // This avoids race conditions and "Cannot read properties of undefined (reading 'map')" errors
      this.log.info(
        "DefaultUserService initialized. User creation/verification will happen at boot.activation"
      );
    } catch (error) {
      this.log.error("Error in DefaultUserService _init:", error);
    }
  }

  async ["__on_boot.activation"]() {
    try {
      this.log.info("Starting DefaultUserService activation");

      // Check if admin user exists
      const adminUser = await this.getAdminUser().catch((err) => {
        this.log.error("Error checking for admin user:", err);
        return null;
      });

      if (!adminUser) {
        this.log.info("Admin user not found, creating...");
        await this.create_default_user_().catch((err) => {
          this.log.error("Failed to create admin user:", err);
        });
      } else {
        this.log.info("Admin user found, ensuring password is set correctly");
        const result = await this.ensureDefaultAdminPassword().catch((err) => {
          this.log.error("Failed to ensure admin password:", err);
          return { success: false, generatedPassword: null };
        });

        if (!result.success) {
          this.log.warn("Could not ensure admin password was set correctly");
        }
      }
    } catch (error) {
      this.log.error("Error in DefaultUserService activation:", error);
    }
  }

  async create_default_user_() {
    const db = this.services.get("database").get(DB_WRITE, USERNAME);

    // Generate UUID for the admin user
    const userUuid = this.modules.uuidv4();

    // Set default admin password
    DEFAULT_PASSWORD = "9668fafe";
    const bcrypt = require("bcrypt");
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 8);

    // Insert admin user with password already set
    await db.write(
      `
        INSERT INTO user (uuid, username, password, free_storage)
        VALUES (?, ?, ?, ?)
      `,
      [
        userUuid,
        USERNAME,
        passwordHash,
        1024 * 1024 * 1024 * 10, // 10 GB
      ]
    );

    const svc_group = this.services.get("group");
    await svc_group.add_users({
      uid: "ca342a5e-b13d-4dee-9048-58b11a57cc55", // admin
      users: [USERNAME],
    });

    const user = await get_user({ username: USERNAME, cached: false });
    const actor = Actor.adapt(user);

    // Log the admin credentials in the console
    this.log.info(
      `Admin user created with username: ${USERNAME} and password: ${DEFAULT_PASSWORD}`
    );

    // Console display for better visibility
    setTimeout(() => {
      const box_w = surrounding_box("Admin Credentials");
      const message = `\n\n${box_w(`username: ${USERNAME}\npassword: ${DEFAULT_PASSWORD}`)}\n\n`;
      console.log(message);
    }, 1000);

    // Set up console widget
    this.default_user_widget = ({ is_docker }) => {
      if (is_docker) {
        return [
          "Admin username: " + USERNAME,
          "Admin password: " + DEFAULT_PASSWORD,
          "",
          "",
        ];
      }

      const lines = [
        `Your admin user has been created!`,
        `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
        `\x1B[32;1mpassword:\x1B[0m ${DEFAULT_PASSWORD}`,
        `(change the password to remove this message)`,
      ];
      surrounding_box("31;1", lines);
      return lines;
    };
    this.default_user_widget.critical = true;

    const svc_devConsole = this.services.get("dev-console");
    svc_devConsole.add_widget(this.default_user_widget);

    // Setup default filesystem entries
    const svc_user = this.services.get("user");
    await svc_user.generate_default_fsentries({ user });

    // Generate default files for admin user
    const svc_fs = this.services.get("filesystem");
    const make_tree_ = async ({ components, tree }) => {
      const parent = await svc_fs.node(
        new NodePathSelector("/" + components.join("/"))
      );
      for (const k in tree) {
        if (typeof tree[k] === "string") {
          const buffer = Buffer.from(tree[k], "utf-8");
          const hl_write = new HLWrite();
          await hl_write.run({
            destination_or_parent: parent,
            specified_name: k,
            file: {
              size: buffer.length,
              stream: buffer_to_stream(buffer),
            },
            user,
          });
        } else {
          const hl_qmkdir = new QuickMkdir();
          await hl_qmkdir.run({
            parent,
            path: k,
          });
          const components_ = [...components, k];
          await make_tree_({
            components: components_,
            tree: tree[k],
          });
        }
      }
    };

    await Context.get()
      .sub({ user, actor })
      .arun(async () => {
        await make_tree_({
          components: ["admin"],
          tree: DEFAULT_FILES,
        });
      });

    invalidate_cached_user(user);
    await new Promise((rslv) => setTimeout(rslv, 2000));
    return user;
  }
  async get_tmp_password_(user) {
    try {
      const actor = await Actor.create(UserActorType, { user });

      return await Context.get()
        .sub({ actor })
        .arun(async () => {
          // First, check if the user has a custom password
          const bcrypt = require("bcrypt");
          DEFAULT_PASSWORD = "9668fafe";

          // If the user has a password, check if it's custom
          if (user.password && user.password.trim() !== "") {
            try {
              // Check if the current password is the default one
              const isDefaultPassword = await bcrypt.compare(
                DEFAULT_PASSWORD,
                user.password
              );

              if (!isDefaultPassword) {
                // User has a custom password
                this.log.info("Detected custom password, preserving it");
                return "custom-password-preserved";
              }
            } catch (compareError) {
              this.log.warn("Could not compare passwords:", compareError);
              // Continue with normal flow
            }
          }

          // Check if the default password is already stored in KV
          const svc_driver = this.services.get("driver");
          const driver_response = await svc_driver.call({
            iface: "puter-kvstore",
            method: "get",
            args: { key: "tmp_password" },
          });

          if (driver_response.result) return driver_response.result;

          // Use fixed default password instead of random
          const tmp_password = "9668fafe";

          // Set it in the KV store
          await svc_driver.call({
            iface: "puter-kvstore",
            method: "set",
            args: {
              key: "tmp_password",
              value: tmp_password,
            },
          });

          return tmp_password;
        });
    } catch (error) {
      this.log.error("Error in get_tmp_password_:", error);
      return "9668fafe"; // Return default as fallback
    }
  }
  async force_tmp_password_(user) {
    try {
      const db = this.services
        .get("database")
        .get(DB_WRITE, "terminal-password-reset");
      const actor = await Actor.create(UserActorType, { user });

      return await Context.get()
        .sub({ actor })
        .arun(async () => {
          // Check if user might have a custom password first
          const bcrypt = require("bcrypt");
          const DEFAULT_PASSWORD = "9668fafe";

          // If the user has a password and it's not the default one, respect it
          if (user.password && user.password.trim() !== "") {
            try {
              // Check if the current password matches default
              const isDefaultPassword = await bcrypt.compare(
                DEFAULT_PASSWORD,
                user.password
              );

              if (!isDefaultPassword) {
                // User has a custom password, don't override it
                this.log.info("User has a custom password, preserving it");
                return "custom-password-preserved";
              }
            } catch (compareError) {
              // If we can't compare, proceed with password reset for safety
              this.log.warn("Could not verify current password:", compareError);
            }
          }

          // Either no password is set or it's the default password
          // Proceed with setting up the default password
          const svc_driver = this.services.get("driver");
          // Use fixed default password instead of random
          const tmp_password = "9668fafe";
          const password_hashed = await bcrypt.hash(tmp_password, 8);

          // Store the password in KV store
          await svc_driver.call({
            iface: "puter-kvstore",
            method: "set",
            args: {
              key: "tmp_password",
              value: tmp_password,
            },
          });

          // Update the user's password in the database
          await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
            password_hashed,
            user.id,
          ]);

          // Invalidate the user cache to ensure updated password takes effect
          invalidate_cached_user(user);

          return tmp_password;
        });
    } catch (error) {
      this.log.error("Error in force_tmp_password_:", error);
      return "9668fafe"; // Return default as fallback
    }
  }
  _register_commands(commands) {
    commands.registerCommands("default-user", [
      {
        id: "reset-password",
        handler: async (args, ctx) => {
          const [username] = args;
          const user = await get_user({ username });
          const tmp_pwd = await this.force_tmp_password_(user);
          ctx.log(`New password for ${quot(username)} is: ${tmp_pwd}`);
        },
      },
      {
        id: "reset-admin-password",
        handler: async (args, ctx) => {
          const result = await this.ensureDefaultAdminPassword();
          if (result.success) {
            ctx.log(
              `Admin password has been reset to: ${result.generatedPassword}`
            );
          } else {
            ctx.log(`Failed to reset admin password, check logs for details`);
          }
        },
      },
    ]);
  }

  /**
   * Get the admin user by username
   *
   * @returns {Promise<Object|null>} The admin user object or null if not found
   */
  async getAdminUser() {
    try {
      // Ensure services are initialized before proceeding
      if (
        !this.services ||
        !this.services.has ||
        !this.services.has("get-user")
      ) {
        this.log.error("Required services not available for getAdminUser");
        return null;
      }

      // Use helper function to get the user
      return await get_user({ username: USERNAME, cached: false });
    } catch (error) {
      this.log.error("Error in getAdminUser:", error);
      return null;
    }
  }

  /**
   * Check if setup has been completed
   */
  async isSetupCompleted() {
    try {
      const fs = require("fs").promises;
      const path = require("path");

      // Primary location for setup-completed
      const setupPath = path.join(
        process.cwd(),
        "volatile",
        "runtime",
        "config",
        "setup-completed"
      );

      // Also check the older location for backward compatibility
      const legacySetupPath = path.join(
        process.cwd(),
        "config",
        "setup-completed"
      );

      try {
        await fs.access(setupPath);
        return true;
      } catch (err) {
        try {
          await fs.access(legacySetupPath);
          return true;
        } catch (err2) {
          return false;
        }
      }
    } catch (error) {
      this.log.error("Error checking if setup is completed:", error);
      return false;
    }
  }

  /**
   * Get password from setup-completed file
   */
  async getPasswordFromSetupFile() {
    try {
      const fs = require("fs").promises;
      const path = require("path");

      // Primary location for setup-completed
      const setupPath = path.join(
        process.cwd(),
        "volatile",
        "runtime",
        "config",
        "setup-completed"
      );

      // Also check the older location for backward compatibility
      const legacySetupPath = path.join(
        process.cwd(),
        "config",
        "setup-completed"
      );

      let fileContent;

      try {
        fileContent = await fs.readFile(setupPath, "utf8");
      } catch (err) {
        try {
          fileContent = await fs.readFile(legacySetupPath, "utf8");
        } catch (err2) {
          return null;
        }
      }

      // Parse the content to find the password
      if (fileContent) {
        try {
          const data = JSON.parse(fileContent);
          if (data && data.adminPassword) {
            return data.adminPassword;
          }
        } catch (parseErr) {
          // If it's not JSON, check if it's the old format with password on a specific line
          const passwordMatch = fileContent.match(/Admin password: ([^\s]+)/);
          if (passwordMatch && passwordMatch[1]) {
            return passwordMatch[1];
          }
        }
      }

      return null;
    } catch (error) {
      this.log.error("Error getting password from setup file:", error);
      return null;
    }
  }

  /**
   * Store password in setup-completed file
   */
  async storePasswordInSetupFile(password, isCustom = false) {
    try {
      const fs = require("fs").promises;
      const path = require("path");

      // Create the directory structure if it doesn't exist
      const configDir = path.join(
        process.cwd(),
        "volatile",
        "runtime",
        "config"
      );

      try {
        await fs.mkdir(configDir, { recursive: true });
      } catch (mkdirErr) {
        this.log.warn("Error creating config directory:", mkdirErr);
      }

      const setupPath = path.join(configDir, "setup-completed");

      // Store the password in JSON format
      const setupData = {
        timestamp: new Date().toISOString(),
        adminPassword: password,
        adminUsername: USERNAME,
        isCustomPassword: isCustom,
      };

      await fs.writeFile(setupPath, JSON.stringify(setupData, null, 2), "utf8");
      this.log.info(
        `Stored admin password in setup file (${isCustom ? "custom" : "random"})`
      );

      // Also update the legacy config location for compatibility
      try {
        const legacyConfigDir = path.join(process.cwd(), "config");
        await fs.mkdir(legacyConfigDir, { recursive: true });

        const legacySetupPath = path.join(legacyConfigDir, "setup-completed");
        await fs.writeFile(
          legacySetupPath,
          JSON.stringify(setupData, null, 2),
          "utf8"
        );
      } catch (legacyErr) {
        this.log.warn("Could not update legacy setup file:", legacyErr);
      }

      return true;
    } catch (error) {
      this.log.error("Error storing password in setup file:", error);
      return false;
    }
  }

  /**
   * Validate custom password
   * Requirements: minimum 4 characters, at least 1 letter, at least 1 number
   */
  validateCustomPassword(password) {
    if (!password || typeof password !== "string") {
      return { valid: false, reason: "Password must be a string" };
    }

    if (password.length < 4) {
      return {
        valid: false,
        reason: "Password must be at least 4 characters long",
      };
    }

    if (!/[a-zA-Z]/.test(password)) {
      return {
        valid: false,
        reason: "Password must contain at least one letter",
      };
    }

    if (!/[0-9]/.test(password)) {
      return {
        valid: false,
        reason: "Password must contain at least one number",
      };
    }

    return { valid: true };
  }

  /**
   * Ensure the admin user has a password set
   * This can be called during initialization to make sure the password is set, but should respect
   * existing custom passwords
   *
   * @returns {Promise<Object>} Object with success status and generated password if one was created
   */
  async ensureDefaultAdminPassword() {
    try {
      this.log.info("Checking admin user password");

      // Get the admin user with additional error handling
      let user = null;
      try {
        // Ensure we have the necessary services
        if (!this.services.has("database")) {
          this.log.error("Database service not available");
          return {
            success: false,
            generatedPassword: null,
          };
        }

        user = await this.getAdminUser();
        if (!user) {
          this.log.error("Admin user not found, cannot check password");
          return {
            success: false,
            generatedPassword: null,
          };
        }

        this.log.info(`Found admin user: ID=${user.id}, UUID=${user.uuid}`);
      } catch (error) {
        this.log.error("Error getting admin user:", error);
        return {
          success: false,
          generatedPassword: null,
        };
      }

      // Check if setup is completed and get password from setup file
      const setupCompleted = await this.isSetupCompleted();
      let adminPassword = null;
      let isCustom = false;

      if (setupCompleted) {
        // Get the password from the setup-completed file
        adminPassword = await this.getPasswordFromSetupFile();

        if (adminPassword) {
          this.log.info("Found admin password in setup file, using it");

          // Check if this is a custom password
          try {
            const fs = require("fs").promises;
            const path = require("path");

            const setupPath = path.join(
              process.cwd(),
              "volatile",
              "runtime",
              "config",
              "setup-completed"
            );

            const fileContent = await fs.readFile(setupPath, "utf8");
            const data = JSON.parse(fileContent);

            if (data && data.isCustomPassword) {
              isCustom = true;
              this.log.info("Password is marked as custom in setup file");
            }
          } catch (err) {
            // Ignore errors when checking for custom flag
          }

          // Apply the password from setup file to ensure consistency
          try {
            const bcrypt = require("bcrypt");
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(adminPassword, salt);

            // Update the password in the database
            const db = this.services.get("database").get(DB_WRITE, USERNAME);
            await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
              passwordHash,
              user.id,
            ]);

            this.log.info("Applied admin password from setup file");
            invalidate_cached_user(user);

            return {
              success: true,
              generatedPassword: adminPassword,
              isCustom: isCustom,
            };
          } catch (error) {
            this.log.error("Failed to apply password from setup file:", error);
          }
        }
      }

      // If we get here, either setup is not completed or no password was found in the setup file
      if (!adminPassword) {
        // Only generate a new password if setup is not completed
        if (!setupCompleted) {
          // Generate a new random password
          adminPassword = this.generateRandomPassword();
          this.log.info(`Generated new random password: ${adminPassword}`);

          // Store the password in the setup file for future use
          await this.storePasswordInSetupFile(adminPassword, false);
        } else {
          // If setup is completed but no password found in file, this is unexpected
          // Generate a new random password in this case
          adminPassword = this.generateRandomPassword();
          this.log.warn(
            `No password found in setup file. Generated new one: ${adminPassword}`
          );

          // Store this password for consistency
          await this.storePasswordInSetupFile(adminPassword, false);
        }

        // Apply the password
        try {
          const bcrypt = require("bcrypt");
          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(adminPassword, salt);

          // Update the password in the database
          const db = this.services.get("database").get(DB_WRITE, USERNAME);
          await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
            passwordHash,
            user.id,
          ]);

          this.log.info(`Admin password updated in database`);
          invalidate_cached_user(user);
        } catch (error) {
          this.log.error("Failed to update admin password:", error);
          return {
            success: false,
            generatedPassword: null,
          };
        }
      }

      return {
        success: true,
        generatedPassword: adminPassword,
        isCustom: isCustom,
      };
    } catch (error) {
      this.log.error("Error in ensureDefaultAdminPassword:", error);
      return {
        success: false,
        generatedPassword: null,
      };
    }
  }

  /**
   * Updates the admin password with a custom password
   * @param {string} password The new password to set
   * @returns {Promise<Object>} Result object with success status
   */
  async updateAdminPassword(password) {
    try {
      this.log.info("Updating admin password with custom password");

      // Validate the custom password
      const validation = this.validateCustomPassword(password);
      if (!validation.valid) {
        this.log.error(
          `Custom password validation failed: ${validation.reason}`
        );
        return {
          success: false,
          message: validation.reason,
        };
      }

      // Get the admin user
      const user = await this.getAdminUser();
      if (!user) {
        this.log.error("Admin user not found, cannot update password");
        return {
          success: false,
          message: "Admin user not found",
        };
      }

      // Hash the new password
      const bcrypt = require("bcrypt");
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // Update the password in the database
      try {
        const db = this.services.get("database").get(DB_WRITE, USERNAME);
        await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
          passwordHash,
          user.id,
        ]);

        this.log.info("Custom admin password updated in database");

        // Store the custom password in the setup file
        await this.storePasswordInSetupFile(password, true);

        // Invalidate user cache
        invalidate_cached_user(user);

        return {
          success: true,
          message: "Admin password updated successfully",
        };
      } catch (dbError) {
        this.log.error("Database error updating admin password:", dbError);
        return {
          success: false,
          message: "Database error updating password",
        };
      }
    } catch (error) {
      this.log.error("Error updating admin password:", error);
      return {
        success: false,
        message: "Internal error updating password",
      };
    }
  }

  /**
   * Display the admin credentials in the console if using default password
   * This should be called at the end of the boot process
   */
  async ["__on_ready.webserver"]() {
    try {
      // Get the admin user
      const user = await this.getAdminUser();
      if (!user) {
        this.log.error("Admin user not found, cannot display credentials");
        return;
      }

      // Check if setup is completed and get password from setup file
      const setupCompleted = await this.isSetupCompleted();
      let passwordToDisplay = "";
      let isCustomPassword = false;

      if (setupCompleted) {
        // Get the password from the setup-completed file
        passwordToDisplay = await this.getPasswordFromSetupFile();

        // Check if this is a custom password
        try {
          const fs = require("fs").promises;
          const path = require("path");

          const setupPath = path.join(
            process.cwd(),
            "volatile",
            "runtime",
            "config",
            "setup-completed"
          );

          const fileContent = await fs.readFile(setupPath, "utf8");
          const data = JSON.parse(fileContent);

          if (data && data.isCustomPassword) {
            isCustomPassword = true;
            this.log.info("Password is marked as custom in setup file");
          }
        } catch (err) {
          // Ignore errors when checking for custom flag
        }

        if (passwordToDisplay) {
          this.log.info("Found password in setup file for display");
        }
      }

      // If no password found in setup file, fall back to the random password generation
      if (!passwordToDisplay) {
        // Only generate a new password if setup is not completed
        if (!setupCompleted) {
          passwordToDisplay = this.generateRandomPassword();
          this.log.info(
            "No password found in setup file, generated one for display"
          );

          // Store this password for consistency
          await this.storePasswordInSetupFile(passwordToDisplay, false);
        } else {
          // This is unexpected - setup is completed but no password in file
          passwordToDisplay = "(Password not available)";
          this.log.warn("Setup is completed but no password found for display");
        }
      }

      // Always display the admin credentials
      setTimeout(() => {
        try {
          const box_w = surrounding_box("Admin Credentials");
          const message = `\n\n${box_w(`username: ${USERNAME}\npassword: ${passwordToDisplay}${isCustomPassword ? " (custom)" : ""}`)}${isCustomPassword ? "\nNote: This is a custom password set during setup." : ""}\n\n`;
          console.log(message);
        } catch (error) {
          this.log.error("Error creating boxed admin credentials:", error);
          // Fallback to simple console log
          console.log("\n\n*** Admin Credentials ***");
          console.log(`username: ${USERNAME}`);
          console.log(
            `password: ${passwordToDisplay}${isCustomPassword ? " (custom)" : ""}\n\n`
          );
        }
      }, 3000); // Longer delay to ensure it appears at the end

      // Set up widget for development console
      try {
        this.default_user_widget = ({ is_docker }) => {
          if (is_docker) {
            return [
              "Admin username: " + USERNAME,
              "Admin password: " +
                passwordToDisplay +
                (isCustomPassword ? " (custom)" : ""),
              "",
              "",
            ];
          }

          try {
            const lines = [
              `Admin user information:`,
              `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
              `\x1B[32;1mpassword:\x1B[0m ${passwordToDisplay}${isCustomPassword ? " (custom)" : ""}`,
            ];
            surrounding_box("31;1", lines);
            return lines;
          } catch (error) {
            return [
              "Admin username: " + USERNAME,
              "Admin password: " +
                passwordToDisplay +
                (isCustomPassword ? " (custom)" : ""),
            ];
          }
        };
      } catch (error) {
        this.log.error("Error setting up admin credentials widget:", error);
      }

      // Set the widget as critical and add to console
      if (this.default_user_widget) {
        this.default_user_widget.critical = true;

        const svc_devConsole = this.services.get("dev-console");
        if (svc_devConsole && typeof svc_devConsole.add_widget === "function") {
          svc_devConsole.add_widget(this.default_user_widget);
        }
      }
    } catch (error) {
      this.log.error("Error in __on_ready.webserver:", error);
    }
  }

  // Generate a random password
  generateRandomPassword() {
    const crypto = require("crypto");
    // Ensure the random password meets our validation requirements
    let password;
    do {
      // Generate 4 bytes of random data (8 hex characters)
      password = crypto.randomBytes(4).toString("hex");
      // Add a letter if there isn't one
      if (!/[a-zA-Z]/.test(password)) {
        const randomLetter = String.fromCharCode(
          97 + Math.floor(Math.random() * 26)
        );
        password = randomLetter + password.substring(1);
      }
      // Add a number if there isn't one
      if (!/[0-9]/.test(password)) {
        const randomDigit = Math.floor(Math.random() * 10).toString();
        password = password.substring(0, password.length - 1) + randomDigit;
      }
    } while (!this.validateCustomPassword(password).valid);

    return password;
  }
}

module.exports = DefaultUserService;
