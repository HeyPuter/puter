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
    const DEFAULT_PASSWORD = "9668fafe";
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
          const DEFAULT_PASSWORD = "9668fafe";

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
   * Ensure the admin user has a password set
   * This can be called during initialization to make sure the password is set, but should respect
   * existing custom passwords
   *
   * @returns {Promise<Object>} Object with success status and generated password if one was created
   */
  async ensureDefaultAdminPassword() {
    try {
      this.log.info("Checking admin user password");

      const DEFAULT_PASSWORD = this.generateRandomPassword();
      let generatedPassword = null;

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

      // Check if a password file from setup exists
      try {
        const fs = require("fs").promises;
        const path = require("path");
        const configDir = path.join(process.cwd(), "config");
        const adminPassPath = path.join(configDir, "admin-password");

        const adminPasswordExists = await fs
          .access(adminPassPath)
          .then(() => true)
          .catch(() => false);

        if (adminPasswordExists) {
          this.log.info(
            "Found saved admin password from setup, using it instead of default"
          );

          // Read the password
          const adminPassword = await fs.readFile(adminPassPath, "utf8");

          if (adminPassword && adminPassword.trim()) {
            try {
              // Apply the password
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

              // Delete the password file after applying it
              await fs.unlink(adminPassPath);
              this.log.info("Deleted saved admin password file for security");

              // Invalidate the cached user since we changed the password
              invalidate_cached_user(user);

              generatedPassword = DEFAULT_PASSWORD;
              return {
                success: true,
                generatedPassword,
              };
            } catch (error) {
              this.log.error(
                "Failed to apply admin password from setup file:",
                error
              );
            }
          }
        }
      } catch (error) {
        this.log.error("Error checking for saved admin password:", error);
      }

      // Check if the admin already has a custom password set
      try {
        const bcrypt = require("bcrypt");

        // Only set default password if no password is set or if it's set to the temporary one
        if (!user.password || user.password.trim() === "") {
          this.log.info("Admin has no password set, setting default password");
        } else {
          // Try to check if the default password matches current password
          try {
            const isDefaultPassword = await bcrypt.compare(
              DEFAULT_PASSWORD,
              user.password
            );

            if (!isDefaultPassword) {
              // User has a custom password set, don't override it
              this.log.info(
                "Admin already has a custom password set. Preserving it."
              );

              // Display admin username info but not the password since it's custom
              setTimeout(() => {
                try {
                  console.log("\n\n*** Admin User Info ***");
                  console.log(`username: ${USERNAME}`);
                  console.log("(Using your custom password)\n\n");
                } catch (error) {
                  // Ignore any display errors
                }
              }, 3000);

              generatedPassword = DEFAULT_PASSWORD;
              return {
                success: true,
                generatedPassword,
              };
            } else {
              this.log.info(
                "Admin is using default password, no action needed"
              );
            }
          } catch (compareError) {
            // If we can't compare, assume it's a custom password for safety
            this.log.warn(
              "Could not verify current password, assuming it's custom:",
              compareError
            );
            generatedPassword = DEFAULT_PASSWORD;
            return {
              success: true,
              generatedPassword,
            };
          }
        }

        // Only reach here if no custom password is set
        // Set the default password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 8);

        // Get a database connection
        const db = this.services.get("database").get(DB_WRITE, USERNAME);

        // Update the password only if no custom password is set
        this.log.info(`Setting default admin password for user ID: ${user.id}`);
        const result = await db.write(
          `UPDATE user SET password = ? WHERE id = ?`,
          [passwordHash, user.id]
        );

        this.log.info(`Admin password set to default: ${DEFAULT_PASSWORD}`);
        generatedPassword = DEFAULT_PASSWORD;
        invalidate_cached_user(user);

        return {
          success: true,
          generatedPassword,
        };
      } catch (error) {
        this.log.error("Failed to update admin password:", error);
        return {
          success: false,
          generatedPassword: null,
        };
      }
    } catch (error) {
      this.log.error("Error in ensureDefaultAdminPassword:", error);
      return {
        success: false,
        generatedPassword: null,
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

      // Generate the same password that would be used by ensureDefaultAdminPassword
      const DEFAULT_PASSWORD = this.generateRandomPassword();
      const bcrypt = require("bcrypt");

      // Try to check if the default password matches current password
      try {
        const isDefaultPassword = await bcrypt.compare(
          DEFAULT_PASSWORD,
          user.password
        );

        if (isDefaultPassword) {
          // User has the default password - show full credentials
          // Log admin credentials at the end of startup
          setTimeout(() => {
            try {
              const box_w = surrounding_box("Admin Credentials");
              const message = `\n\n${box_w(`username: ${USERNAME}\npassword: ${DEFAULT_PASSWORD}`)}\n\n`;
              console.log(message);
            } catch (error) {
              this.log.error("Error creating boxed admin credentials:", error);
              // Fallback to simple console log
              console.log("\n\n*** Admin Credentials ***");
              console.log(`username: ${USERNAME}`);
              console.log(`password: ${DEFAULT_PASSWORD}\n\n`);
            }
          }, 3000); // Longer delay to ensure it appears at the end

          // Set up widget for development console with default password
          try {
            this.default_user_widget = ({ is_docker }) => {
              if (is_docker) {
                return [
                  "Admin username: " + USERNAME,
                  "Admin password: " + DEFAULT_PASSWORD,
                  "",
                  "",
                ];
              }

              try {
                const lines = [
                  `Your admin user has been created!`,
                  `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
                  `\x1B[32;1mpassword:\x1B[0m ${DEFAULT_PASSWORD}`,
                  `(change the password to remove this message)`,
                ];
                surrounding_box("31;1", lines);
                return lines;
              } catch (error) {
                return [
                  "Admin username: " + USERNAME,
                  "Admin password: " + DEFAULT_PASSWORD,
                ];
              }
            };
          } catch (error) {
            this.log.error("Error setting up admin credentials widget:", error);
          }
        } else {
          // User has a custom password - only show username
          setTimeout(() => {
            console.log("\n\n*** Admin User Info ***");
            console.log(`username: ${USERNAME}`);
            console.log("(Using your custom password)\n\n");
          }, 3000);

          // Set up widget for development console with custom password notice
          try {
            this.default_user_widget = ({ is_docker }) => {
              if (is_docker) {
                return [
                  "Admin username: " + USERNAME,
                  "(Custom password set)",
                  "",
                  "",
                ];
              }

              try {
                const lines = [
                  `Admin user information:`,
                  `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
                  `\x1B[32;1mpassword:\x1B[0m (Custom password set)`,
                ];
                surrounding_box("31;1", lines);
                return lines;
              } catch (error) {
                return ["Admin username: " + USERNAME, "(Custom password set)"];
              }
            };
          } catch (error) {
            this.log.error("Error setting up admin credentials widget:", error);
          }
        }

        // Set the widget as critical and add to console
        if (this.default_user_widget) {
          this.default_user_widget.critical = true;

          const svc_devConsole = this.services.get("dev-console");
          if (
            svc_devConsole &&
            typeof svc_devConsole.add_widget === "function"
          ) {
            svc_devConsole.add_widget(this.default_user_widget);
          }
        }
      } catch (error) {
        this.log.error("Error checking admin password:", error);

        // Display generic admin username info in case of error
        setTimeout(() => {
          console.log("\n\n*** Admin User Info ***");
          console.log(`username: ${USERNAME}\n\n`);
        }, 3000);
      }
    } catch (error) {
      this.log.error("Error in __on_ready.webserver:", error);
    }
  }

  // Generate a random password
  generateRandomPassword() {
    const crypto = require("crypto");
    return crypto.randomBytes(4).toString("hex");
  }
}

module.exports = DefaultUserService;
