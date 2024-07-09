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
const APIError = require("../../api/APIError");
const Group = require("../../entities/Group");
const { DENY_SERVICE_INSTRUCTION } = require("../AnomalyService");
const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");

class GroupService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    };

    _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'permissions');

        const svc_anomaly = this.services.get('anomaly');
        svc_anomaly.register('groups-user-hour', {
            high: 20,
        });
    }
    
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
    
    async create ({ owner_user_id, extra, metadata }) {
        extra = extra ?? {};
        metadata = metadata ?? {};
        
        const uid = this.modules.uuidv4();

        const [{ n_groups }] = await this.db.read(
            "SELECT COUNT(*) AS n_groups FROM `group` WHERE " +
            "owner_user_id=? AND " +
            "created_at >= datetime('now', '-1 hour')",
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
