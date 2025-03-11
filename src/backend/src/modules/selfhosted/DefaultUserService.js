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
  };
  async _init() {
    this._register_commands(this.services.get("commands"));

    let user = await get_user({ username: USERNAME });

    if (!user) {
      this.log.info("Creating admin user");
      user = await this.create_default_user_();
    }

    // Check for saved admin password from setup
    const fs = require("fs").promises;
    const path = require("path");
    const configDir = path.join(process.cwd(), "config");
    const adminPassPath = path.join(configDir, "admin-password");

    try {
      // Check if admin password file exists
      const adminPasswordExists = await fs
        .access(adminPassPath)
        .then(() => true)
        .catch(() => false);

      if (adminPasswordExists) {
        this.log.info("Found saved admin password from setup, applying it");

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

            this.log.info("Applied saved admin password");

            // Delete the password file after applying it
            await fs.unlink(adminPassPath);
            this.log.info("Deleted saved admin password file for security");

            // Invalidate the cached user since we changed the password
            invalidate_cached_user(user);

            // Refresh user data with updated password
            user = await get_user({ username: USERNAME, cached: false });
          } catch (error) {
            this.log.error("Failed to apply saved admin password:", error);
          }
        }
      }
    } catch (error) {
      this.log.error("Error checking for saved admin password:", error);
    }
  }
  async ["__on_ready.webserver"]() {
    let user = await get_user({ username: USERNAME });

    if (!user) {
      this.log.info("Creating admin user");
      user = await this.create_default_user_();
    }

    // Check if a password has already been set
    // This could happen if we applied a saved password during initialization
    this.log.info("Checking if admin password is already set");

    const require = this.require;
    const bcrypt = require("bcrypt");

    // Generate a temporary password as a fallback
    const tmp_password = await this.get_tmp_password_(user);

    // Check if the temporary password is already the current password
    // If it's not, it means either a custom password was set or we applied the saved password
    const is_default_password = await bcrypt.compare(
      tmp_password,
      user.password
    );

    if (!is_default_password) {
      this.log.info(
        "Admin user already has a custom password set, skipping temporary password"
      );
      return;
    }

    // If we got here, we need to display the temporary password in the console
    await this.force_tmp_password_(user);

    // show console widget with the temporary password
    this.default_user_widget = ({ is_docker }) => {
      if (is_docker) {
        // In Docker we keep the output as simple as possible because
        // we're unable to determine the size of the terminal
        return [
          "Password for `admin`: " + tmp_password,
          // TODO: possible bug
          // These blank lines are necessary for it to render and
          // I'm not entirely sure why anymore.
          "",
          "",
        ];
      }
      const lines = [
        `Your admin user has been created!`,
        `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
        `\x1B[32;1mpassword:\x1B[0m ${tmp_password}`,
        `(change the password to remove this message)`,
      ];
      surrounding_box("31;1", lines);
      return lines;
    };
    this.default_user_widget.critical = true;

    // Start polling to check if the password has been changed
    this.start_poll_({ tmp_password, user });
    const svc_devConsole = this.services.get("dev-console");
    svc_devConsole.add_widget(this.default_user_widget);
  }
  start_poll_({ tmp_password, user }) {
    const interval = 1000 * 3; // 3 seconds
    const poll_interval = asyncSafeSetInterval(async () => {
      const user = await get_user({ username: USERNAME });
      const require = this.require;
      const bcrypt = require("bcrypt");
      const is_default_password = await bcrypt.compare(
        tmp_password,
        user.password
      );
      if (!is_default_password) {
        const svc_devConsole = this.services.get("dev-console");
        svc_devConsole.remove_widget(this.default_user_widget);
        clearInterval(poll_interval);
        return;
      }
    }, interval);
  }
  async create_default_user_() {
    const db = this.services.get("database").get(DB_WRITE, USERNAME);
    await db.write(
      `
                INSERT INTO user (uuid, username, free_storage)
                VALUES (?, ?, ?)
            `,
      [
        this.modules.uuidv4(),
        USERNAME,
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
    const tmp_password = await this.get_tmp_password_(user);
    const bcrypt = require("bcrypt");
    const password_hashed = await bcrypt.hash(tmp_password, 8);
    await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
      password_hashed,
      user.id,
    ]);
    user.password = password_hashed;
    const svc_user = this.services.get("user");
    await svc_user.generate_default_fsentries({ user });
    // generate default files for admin user
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
    const actor = await Actor.create(UserActorType, { user });
    return await Context.get()
      .sub({ actor })
      .arun(async () => {
        const svc_driver = this.services.get("driver");
        const driver_response = await svc_driver.call({
          iface: "puter-kvstore",
          method: "get",
          args: { key: "tmp_password" },
        });

        if (driver_response.result) return driver_response.result;

        const tmp_password = require("crypto").randomBytes(4).toString("hex");
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
  }
  async force_tmp_password_(user) {
    const db = this.services
      .get("database")
      .get(DB_WRITE, "terminal-password-reset");
    const actor = await Actor.create(UserActorType, { user });
    return await Context.get()
      .sub({ actor })
      .arun(async () => {
        const svc_driver = this.services.get("driver");
        const tmp_password = require("crypto").randomBytes(4).toString("hex");
        const bcrypt = require("bcrypt");
        const password_hashed = await bcrypt.hash(tmp_password, 8);
        await svc_driver.call({
          iface: "puter-kvstore",
          method: "set",
          args: {
            key: "tmp_password",
            value: tmp_password,
          },
        });
        await db.write(`UPDATE user SET password = ? WHERE id = ?`, [
          password_hashed,
          user.id,
        ]);
        return tmp_password;
      });
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
    ]);
  }

  /**
   * Get the admin user by username
   *
   * @returns {Promise<Object|null>} The admin user object or null if not found
   */
  async getAdminUser() {
    return await get_user({ username: USERNAME, cached: false });
  }
}

module.exports = DefaultUserService;
