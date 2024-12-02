// METADATA // {"ai-commented":{"service":"xai"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const BaseService = require("../BaseService");
const { UserActorType, AppUnderUserActorType } = require("../auth/Actor");
const { DB_WRITE } = require("../database/consts");


/**
* MonthlyUsageService - A service class for managing and tracking monthly usage statistics.
* 
* This class extends BaseService to provide functionalities related to:
* - Incrementing usage counts for actors (users or applications under users).
* - Checking current usage against specified criteria for both users and applications.
* - Handling different types of actors (UserActorType, AppUnderUserActorType) to ensure 
*   appropriate data segregation and usage limits enforcement.
* 
* @extends BaseService
*/
class MonthlyUsageService extends BaseService {
    /**
    * Initializes the MonthlyUsageService by setting up the database connection.
    * 
    * @memberof MonthlyUsageService
    * @method
    * @instance
    * @async
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    * 
    * @note This method sets the `db` property to a write-enabled database connection for usage data.
    */
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'usage');
    }


    /**
    * Increments the usage count for a specific actor and key.
    * 
    * @param {Object} actor - The actor object whose usage is being tracked.
    * @param {string} key - The usage key to increment.
    * @param {Object} extra - Additional metadata to store with the usage record.
    * 
    * @note This method generates a unique key based on the actor's UID and the provided key.
    * @note The method performs an UPSERT operation, ensuring the count is incremented or set to 1 if new.
    * @note The `extra` parameter is stringified before being stored in the database.
    * @returns {Promise<void>} - A promise that resolves when the increment operation is complete.
    */
    async increment (actor, key, extra) {
        key = `${actor.uid}:${key}`;

        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const maybe_app_id = actor.type.app?.id;
        const stringified = JSON.stringify(extra);

        // UPSERT increment count
        await this.db.write(
            'INSERT INTO `service_usage_monthly` (`year`, `month`, `key`, `count`, `user_id`, `app_id`, `extra`) ' +
            'VALUES (?, ?, ?, 1, ?, ?, ?) ' +
            this.db.case({
                mysql: 'ON DUPLICATE KEY UPDATE `count` = `count` + 1, `extra` = ?',
                // sqlite: ' ',
                otherwise: 'ON CONFLICT(`year`, `month`, `key`) ' +
                    'DO UPDATE SET `count` = `count` + 1, `extra` = ?',
            }),
            [
                year, month, key, actor.type.user.id, maybe_app_id ?? null, stringified,
                stringified,
            ]
        );
    }


    /**
    * Checks the monthly usage for the given actor based on specific criteria.
    * 
    * This method determines the type of actor and delegates the check to the appropriate
    * method for further processing. It supports both user and app-under-user actors.
    * 
    * @param {Object} actor - The actor whose usage needs to be checked.
    * @param {Object} specifiers - JSON object specifying conditions for the usage check.
    * @returns {Promise<number>} The total usage count or 0 if no matching records found.
    */
    async check (actor, specifiers) {
        if ( actor.type instanceof UserActorType ) {
            return await this._user_check(actor, specifiers);
        }

        if ( actor.type instanceof AppUnderUserActorType ) {
            return await this._app_under_user_check(actor, specifiers);
        }

    }


    /**
    * Checks usage for an actor, routing to specific check methods based on actor type.
    * @param {Object} actor - The actor to check usage for.
    * @param {Object} specifiers - Additional specifiers for the usage check.
    * @returns {Promise<Number>} The usage count or 0 if no usage is found.
    */
    async check_2 (actor, key, ver) {
        // TODO: get 'ver' working here for future updates
        key = `${actor.uid}:${key}`;
        if ( actor.type instanceof UserActorType ) {
            return await this._user_check_2(actor, key);
        }

        if ( actor.type instanceof AppUnderUserActorType ) {
            return await this._app_under_user_check_2(actor, key);
        }

    }


    /**
    * Performs a secondary check on usage for either user or app under user actors.
    * 
    * @param {Object} actor - The actor performing the action.
    * @param {string} key - The usage key to check.
    * @param {string} ver - The version, currently not implemented for future updates.
    * @returns {Promise<number>} A promise that resolves to the count of usage, or 0 if not found.
    * @note The 'ver' parameter is planned for future use to handle version-specific checks.
    */
    async _user_check (actor, specifiers) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const rows = await this.db.read(
            'SELECT SUM(`count`) AS sum FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND JSON_CONTAINS(`extra`, ?)',
            [
                year, month, actor.type.user.id,
                JSON.stringify(specifiers),
            ]
        );

        return rows[0]?.sum || 0;
    }


    /**
    * Performs a usage check for a user based on a specific key.
    * 
    * @param {Object} actor - The actor object representing the user or app.
    * @param {string} key - The unique key to check usage for.
    * @returns {Promise<number>} The sum of usage count for the specified key, or 0 if not found.
    * @note This method is intended for future updates where version control might be implemented.
    */
    async _user_check_2 (actor, key) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        // console.log(
        //     'what check query?',
        //     'SELECT SUM(`count`) AS sum FROM `service_usage_monthly` ' +
        //     'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
        //     'AND `key` = ?',
        //     [
        //         year, month, actor.type.user.id,
        //         key,
        //     ]
        // );
        const rows = await this.db.read(
            'SELECT SUM(`count`) AS sum FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND `key` = ?',
            [
                year, month, actor.type.user.id,
                key,
            ]
        );
        
        return rows[0]?.sum || 0;
    }


    /**
    * Checks the monthly usage for an app under a user account.
    * 
    * @param {Object} actor - The actor object representing the user and app context.
    * @param {Object} specifiers - An object containing usage specifiers to filter the query.
    * @returns {Promise<number>} - The count of usage for the specified criteria or 0 if not found.
    * @note This method queries the database for usage data specific to an app within a user's account.
    *       It uses JSON_CONTAINS to match specifiers within the extra field of the database entry.
    */
    async _app_under_user_check (actor, specifiers) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        const specifier_entries = Object.entries(specifiers);

        // SELECT count
        const rows = await this.db.read(
            'SELECT `count` FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND `app_id` = ? ' +
            'AND JSON_CONTAINS(`extra`, ?)',
            [
                year, month, actor.type.user.id,
                actor.type.app.id,
                specifiers,
            ]
        );

        return rows[0]?.count || 0;
    }


    /**
    * Performs a check for usage under an app, identified by a specific key.
    * This method queries the database to retrieve the usage count for a given user, app, and key.
    * 
    * @param {Actor} actor - The actor object containing user and app information.
    * @param {string} key - The usage key to check against.
    * @returns {Promise<number>} - A promise that resolves to the usage count or 0 if no record exists.
    */
    async _app_under_user_check_2 (actor, key) {
        const year = new Date().getUTCFullYear();
        // months are zero-indexed by getUTCMonth, which could be confusing
        const month = new Date().getUTCMonth() + 1;

        // SELECT count
        const rows = await this.db.read(
            'SELECT `count` FROM `service_usage_monthly` ' +
            'WHERE `year` = ? AND `month` = ? AND `user_id` = ? ' +
            'AND `app_id` = ? ' +
            'AND `key` = ?',
            [
                year, month, actor.type.user.id,
                actor.type.app.id,
                key,
            ]
        );

        return rows[0]?.count || 0;
    }
}

module.exports = {
    MonthlyUsageService,
};
