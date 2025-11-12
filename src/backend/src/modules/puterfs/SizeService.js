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
const { get_dir_size, id2path, get_user, invalidate_cached_user_by_id } = require("../../helpers");
const BaseService = require("../../services/BaseService");

const { DB_WRITE } = require("../../services/database/consts");
const { Context } = require("../../util/context");
const { nou } = require("../../util/langutil");

// TODO: expose to a utility library
class UserParameter {
    static async adapt (value) {
        if ( typeof value == 'object' ) return value;
        const query_object = typeof value === 'number'
            ? { id: value }
            : { username: value };
        return await get_user(query_object);
    }
}

class SizeService extends BaseService {
    _construct () {
        this.usages = {};
    }
    
    _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'filesystem');

    }

    ['__on_boot.consolidate'] () {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('size', [
            {
                id: 'get-usage',
                description: 'get usage for a user',
                handler: async (args, log) => {
                    const user = await UserParameter.adapt(args[0]);
                    const usage = await this.get_usage(user.id);
                    log.log(`usage: ${usage} bytes`);
                }
            },
            {
                id: 'get-capacity',
                description: 'get storage capacity for a user',
                handler: async (args, log) => {
                    const user = await UserParameter.adapt(args[0]);
                    const capacity = await this.get_storage_capacity(user);
                    log.log(`capacity: ${capacity} bytes`);
                }
            },
            {
                id: 'get-cache-size',
                description: 'get the number of cached users',
                handler: async (args, log) => {
                    const size = Object.keys(this.usages).length;
                    log.log(`cache size: ${size}`);
                }
            },
        ])
    }

    async get_usage (user_id) {
        // if ( this.usages.hasOwnProperty(user_id) ) {
        //     return this.usages[user_id];
        // }

        const fsentry = await this.db.read(
            "SELECT SUM(size) AS total FROM `fsentries` WHERE `user_id` = ? LIMIT 1",
            [user_id]
        );
        if(!fsentry[0] || !fsentry[0].total) {
            this.usages[user_id] = 0;
        } else {
            this.usages[user_id] = parseInt(fsentry[0].total);
        }

        return this.usages[user_id];
    }

    async change_usage (user_id, delta) {
        const usage = await this.get_usage(user_id);
        this.usages[user_id] = usage + delta;
    }

    // TODO: remove fs arg and update all calls
    async add_node_size (fs, node, user, factor = 1) {
        const {
            fsEntryService
        } = Context.get('services').values;

        let sz;
        if ( node.entry.is_dir ) {
            if ( node.entry.uuid ) {
                sz = await node.fetchSize();
            } else {
                // very unlikely, but a warning is better than a throw right now
                // TODO: remove this once we're sure this is never hit
                this.log.warn('add_node_size: node has no uuid :(', node)
                sz = await get_dir_size(await id2path(node.mysql_id), user);
            }
        } else {
            sz = node.entry.size;
        }
        await this.change_usage(user.id, sz * factor);
    }

    async get_storage_capacity (user_or_id) {
        const user = await UserParameter.adapt(user_or_id);
        if ( ! this.global_config.is_storage_limited ) {
            return this.global_config.available_device_storage;
        }
        
        if ( nou(user.free_storage) ) {
            return this.global_config.storage_capacity;
        }

        return user.free_storage;
    }

    /**
     * Attempt to add storage for a user.

     * In the case of an error, this method will fail silently to the caller and
     * produce an alarm for further investigation.
     *
     * @param {*} user_or_id - user id, username, or user object
     * @param {*} amount_in_bytes - amount of bytes to add
     * @param {*} reason - please specify a reason for the storage increase
     * @param {*} param3 - optional fields to add to the audit log
     */
    async add_storage (user_or_id, amount_in_bytes, reason, { field_a, field_b } = {}) {
        const user = await UserParameter.adapt(user_or_id);
        const capacity = await this.get_storage_capacity(user);

        // Audit log
        {
            const entry = {
                user_id: user.id,
                user_id_keep: user.id,
                amount: amount_in_bytes,
                reason,
                ...(field_a ? { field_a } : {}),
                ...(field_b ? { field_b } : {}),
            };

            const fields_ = Object.keys(entry);
            const fields = fields_.join(', ');
            const placeholders = fields_.map(f => '?').join(', ');
            const values = fields_.map(f => entry[f]);

            try {
                await this.db.write(
                    `INSERT INTO storage_audit (${fields}) VALUES (${placeholders})`,
                    values,
                );
            } catch (e) {
                this.errors.report('size-service.audit-add-storage', {
                    source: e,
                    trace: true,
                    alarm: true,
                })
            }
        }

        // Storage increase
        {
            try {
                const res = await this.db.write(
                    "UPDATE `user` SET `free_storage` = ? WHERE `id` = ? LIMIT 1",
                    [capacity + amount_in_bytes, user.id]
                );
                if ( ! res.anyRowsAffected ) {
                    throw new Error(`add_storage: failed to update user ${user.id}`);
                }
            } catch (e) {
                this.errors.report('size-service.add-storage', {
                    source: e,
                    trace: true,
                    alarm: true,
                })
            }
            invalidate_cached_user_by_id(user.id);
        }
    }
}

module.exports = {
    SizeService,
};
