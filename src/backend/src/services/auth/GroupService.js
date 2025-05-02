// METADATA // {"ai-commented":{"service":"xai"}}
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
const APIError = require("../../api/APIError");
const Group = require("../../entities/Group");
const { DENY_SERVICE_INSTRUCTION } = require("../AnomalyService");
const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");


/**
* The GroupService class provides functionality for managing groups within the Puter application.
* It extends the BaseService to handle group-related operations such as creation, retrieval,
* listing members, adding or removing users from groups, and more. This service interacts with
* the database to perform CRUD operations on group entities, ensuring proper management
* of user permissions and group metadata.
*/
class GroupService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
        uuidv4: require('uuid').v4,
    };


    /**
    * Initializes the GroupService by setting up the database connection and registering
    * with the anomaly service for monitoring group creation rates.
    * 
    * @memberof GroupService
    * @instance
    */
    _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'permissions');
        this.kvkey = this.modules.uuidv4();

        const svc_anomaly = this.services.get('anomaly');
        svc_anomaly.register('groups-user-hour', {
            high: 20,
        });
    }
    

    /**
    * Retrieves a group by its unique identifier (UID).
    * 
    * @param {Object} params - The parameters object.
    * @param {string} params.uid - The unique identifier of the group.
    * @returns {Promise<Object|undefined>} The group object if found, otherwise undefined.
    * @throws {Error} If there's an issue with the database query.
    * 
    * This method fetches a group from the database using its UID. If the group 
    * does not exist, it returns undefined. The 'extra' and 'metadata' fields are 
    * parsed from JSON strings to objects if not using MySQL, otherwise they remain 
    * as strings.
    */
    async get({ uid }) {
        const [group] =
            await this.db.read('SELECT * FROM `group` WHERE uid=?', [uid]);
        if ( ! group ) return;
        group.extra = this.db.case({
            mysql: () => group.extra,
            otherwise: () => JSON.parse(group.extra),
        })();
        group.metadata = this.db.case({
            mysql: () => group.metadata,
            otherwise: () => JSON.parse(group.metadata),
        })();
        return group;
    }
    

    /**
    * Creates a new group with the provided owner, extra data, and metadata.
    * This method performs rate limiting checks to prevent abuse, generates a unique identifier for the group,
    * and handles the database insertion of the group details.
    * 
    * @param {Object} options - The options object for creating a group.
    * @param {string} options.owner_user_id - The ID of the user who owns the group.
    * @param {Object} [options.extra] - Additional data associated with the group.
    * @param {Object} [options.metadata] - Metadata for the group, which can be used for various purposes.
    * @returns {Promise<string>} - A promise that resolves to the unique identifier of the newly created group.
    * @throws {APIError} If the rate limit is exceeded.
    */
    async create ({ owner_user_id, extra, metadata }) {
        extra = extra ?? {};
        metadata = metadata ?? {};
        
        const uid = this.modules.uuidv4();

        const [{ n_groups }] = await this.db.read(
            "SELECT COUNT(*) AS n_groups FROM `group` WHERE " +
            "owner_user_id=? AND created_at >= " +
            this.db.case({
                sqlite: "datetime('now', '-1 hour')",
                otherwise: "NOW() - INTERVAL 1 HOUR"
            }),
            [owner_user_id]
        );

        const svc_anomaly = this.services.get('anomaly');
        const anomaly = await svc_anomaly.note('groups-user-hour', {
            value: n_groups,
            user_id: owner_user_id,
        });

        if ( anomaly && anomaly.has(DENY_SERVICE_INSTRUCTION) ) {
            throw APIError.create('too_many_requests');
        }

        await this.db.write(
            'INSERT INTO `group` ' +
            '(`uid`, `owner_user_id`, `extra`, `metadata`) ' +
            'VALUES (?, ?, ?, ?)',
            [
                uid, owner_user_id,
                JSON.stringify(extra),
                JSON.stringify(metadata),
            ]
        );
        
        return uid;
    }


    /**
    * Lists all groups where the specified user is a member.
    * 
    * This method queries the database to find groups associated with the given user_id through the junction table `jct_user_group`.
    * Each group's `extra` and `metadata` fields are parsed based on the database type to ensure compatibility.
    *
    * @param {Object} params - Parameters for the query.
    * @param {string} params.user_id - The ID of the user whose groups are to be listed.
    * @returns {Promise<Array<Group>>} A promise that resolves to an array of Group objects representing groups the user is a member of.
    */
    async list_groups_with_owner ({ owner_user_id }) {
        const groups = await this.db.read(
            'SELECT * FROM `group` WHERE owner_user_id=?',
            [owner_user_id],
        );
        for ( const group of groups ) {
            group.extra = this.db.case({
                mysql: () => group.extra,
                otherwise: () => JSON.parse(group.extra),
            })();
            group.metadata = this.db.case({
                mysql: () => group.metadata,
                otherwise: () => JSON.parse(group.metadata),
            })();
        }
        return groups.map(g => Group(g));
    }


    /**
    * Lists all groups where the specified user is a member.
    * 
    * @param {Object} options - The options object.
    * @param {string} options.user_id - The ID of the user whose group memberships are to be listed.
    * @returns {Promise<Array>} A promise that resolves to an array of Group objects representing the groups the user is a member of.
    */
    async list_groups_with_member ({ user_id }) {
        const groups = await this.db.read(
            'SELECT * FROM `group` WHERE id IN (' +
                'SELECT group_id FROM `jct_user_group` WHERE user_id=?)',
            [user_id],
        );
        for ( const group of groups ) {
            group.extra = this.db.case({
                mysql: () => group.extra,
                otherwise: () => JSON.parse(group.extra),
            })();
            group.metadata = this.db.case({
                mysql: () => group.metadata,
                otherwise: () => JSON.parse(group.metadata),
            })();
        }
        return groups.map(g => Group(g));
    }


    /**
     * Lists public groups. May get groups from kv.js cache.
     */
    async list_public_groups () {
        const public_group_uids = [
            this.global_config.default_user_group,
            this.global_config.default_temp_group,
        ];

        let groups = this.modules.kv.get(`${this.kvkey}:public-groups`);
        if ( groups ) {
            return groups;
        }

        groups = await this.db.read(
            'SELECT * FROM `group` WHERE uid IN (' +
                public_group_uids.map(() => '?').join(', ') +
            ')',
            public_group_uids,
        );
        for ( const group of groups ) {
            group.extra = this.db.case({
                mysql: () => group.extra,
                otherwise: () => JSON.parse(group.extra),
            })();
            group.metadata = this.db.case({
                mysql: () => group.metadata,
                otherwise: () => JSON.parse(group.metadata),
            })();
        }
        groups = groups.map(g => Group(g));
        this.modules.kv.set(`${this.kvkey}:public-groups`, groups, 60);
        return groups;
    }


    /**
    * Lists the members of a group by their username.
    * 
    * @param {Object} options - The options object.
    * @param {string} options.uid - The unique identifier of the group.
    * @returns {Promise<string[]>} A promise that resolves to an array of usernames of the group members.
    */
    async list_members ({ uid }) {
        const users = await this.db.read(
            'SELECT u.username FROM user u ' +
            'JOIN (SELECT user_id FROM `jct_user_group` WHERE group_id = ' +
                '(SELECT id FROM `group` WHERE uid=?)) ug ' +
            'ON u.id = ug.user_id',
            [uid],
        );
        return users.map(u => u.username);
    }

    

    /**
    * Adds specified users to a group.
    * 
    * @param {Object} options - The options object.
    * @param {string} options.uid - The unique identifier of the group.
    * @param {string[]} options.users - An array of usernames to add to the group.
    * @returns {Promise<void>} A promise that resolves when the users have been added.
    * @throws {APIError} If there's an issue with the database operation or if the group does not exist.
    */
    async add_users ({ uid, users }) {
        const question_marks =
            '(' + Array(users.length).fill('?').join(', ') + ')';
        await this.db.write(
            'INSERT INTO `jct_user_group` ' +
            '(user_id, group_id) ' +
            'SELECT u.id, g.id FROM user u '+
            'JOIN (SELECT id FROM `group` WHERE uid=?) g ON 1=1 ' +
            'WHERE u.username IN ' +
            question_marks,
            [uid, ...users],
        );
    }
    

    /**
    * Removes specified users from a group.
    * 
    * This method deletes the association between users and a group from the junction table.
    * It uses the group's uid to identify the group and an array of usernames to remove.
    * 
    * @param {Object} params - The parameters for the operation.
    * @param {string} params.uid - The unique identifier of the group.
    * @param {string[]} params.users - An array of usernames to be removed from the group.
    * @returns {Promise<void>} A promise that resolves when the operation is complete.
    */
    async remove_users ({ uid, users }) {
        const question_marks =
            '(' + Array(users.length).fill('?').join(', ') + ')';
        /*
DELETE FROM `jct_user_group`
WHERE group_id = 1
AND user_id IN (
    SELECT u.id
    FROM user u
    WHERE u.username IN ('user_that_shares', 'user_that_gets_shared_to')
);
        */
        await this.db.write(
            'DELETE FROM `jct_user_group` ' +
            'WHERE group_id = (SELECT id FROM `group` WHERE uid=?) ' +
            'AND user_id IN (' +
                'SELECT u.id FROM user u ' +
                'WHERE u.username IN ' +
                question_marks +
            ')',
            [uid, ...users],
        );
    }
}

module.exports = {
    GroupService,
};
