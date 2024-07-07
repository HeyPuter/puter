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
const { asyncSafeSetInterval } = require("../util/promise");
const { MINUTE, SECOND } = require("../util/time");
const { origin_from_url } = require("../util/urlutil");
const { DB_READ } = require("./database/consts");

const uuidv4 = require('uuid').v4;

class AppInformationService {
    constructor ({ services }) {
        this.services = services;
        this.log = services.get('log-service').create('app-info');

        this.collections = {};
        this.collections.recent = [];

        this.tags = {};

        (async () => {
            // await new Promise(rslv => setTimeout(rslv, 500))

            await this._refresh_app_cache();
            asyncSafeSetInterval(async () => {
                this._refresh_app_cache();
            }, 30 * 1000);

            await this._refresh_app_stats();
            asyncSafeSetInterval(async () => {
                this._refresh_app_stats();
            }, 120 * 1000);

            // This stat is more expensive so we don't update it as often
            await this._refresh_app_stat_referrals();
            asyncSafeSetInterval(async () => {
                this._refresh_app_stat_referrals();
            }, 15 * MINUTE);

            await this._refresh_recent_cache();
            asyncSafeSetInterval(async () => {
                this._refresh_recent_cache();
            }, 120 * 1000);

            await this._refresh_tags();
            asyncSafeSetInterval(async () => {
                this._refresh_tags();
            } , 120 * 1000);
        })();
    }

    async get_stats (app_uid) {
        const db = this.services.get('database').get(DB_READ, 'apps');

        const key_open_count = `apps:open_count:uid:${app_uid}`;
        let open_count = kv.get(key_open_count);
        if ( ! open_count ) {
            open_count = (await db.read(
                `SELECT COUNT(_id) AS open_count FROM app_opens WHERE app_uid = ?`,
                [app_uid]
            ))[0].open_count;
        }

        // TODO: cache
        const key_user_count = `apps:user_count:uid:${app_uid}`;
        let user_count = kv.get(key_user_count);
        if ( ! user_count ) {
            user_count = (await db.read(
                `SELECT COUNT(DISTINCT user_id) AS user_count FROM app_opens WHERE app_uid = ?`,
                [app_uid]
            ))[0].user_count;
        }

        const key_referral_count = `apps:referral_count:uid:${app_uid}`;
        let referral_count = kv.get(key_referral_count);
        if ( ! referral_count ) {
            // NOOP: this operation is expensive so if it's not cached
            // we simply won't report it
        }

        return {
            open_count,
            user_count,
            referral_count,
        };
    }

    async _refresh_app_cache () {
        this.log.tick('refresh app cache');

        const db = this.services.get('database').get(DB_READ, 'apps');

        let apps = await db.read('SELECT * FROM apps');
        for (let index = 0; index < apps.length; index++) {
            const app = apps[index];
            kv.set('apps:name:' + app.name, app);
            kv.set('apps:id:' + app.id, app);
            kv.set('apps:uid:' + app.uid, app);
        }
    }

    async _refresh_app_stats () {
        this.log.tick('refresh app stats');

        const db = this.services.get('database').get(DB_READ, 'apps');

        // you know, it's interesting that I need to specify 'uid'
        // meanwhile static analysis of the code could determine that
        // no other column here is ever used.
        // I'm not suggesting a specific solution for here, but it's
        // interesting to think about.

        const apps = await db.read(`SELECT uid FROM apps`);

        for ( const app of apps ) {
            const key_open_count = `apps:open_count:uid:${app.uid}`;
            const { open_count } = (await db.read(
                `SELECT COUNT(_id) AS open_count FROM app_opens WHERE app_uid = ?`,
                [app.uid]
            ))[0];
            kv.set(key_open_count, open_count);

            const key_user_count = `apps:user_count:uid:${app.uid}`;
            const { user_count } = (await db.read(
                `SELECT COUNT(DISTINCT user_id) AS user_count FROM app_opens WHERE app_uid = ?`,
                [app.uid]
            ))[0];
            kv.set(key_user_count, user_count);
        }
    }

    async _refresh_app_stat_referrals () {
        this.log.tick('refresh app stat referrals');

        const db = this.services.get('database').get(DB_READ, 'apps');

        const apps = await db.read(`SELECT uid, index_url FROM apps`);

        for ( const app of apps ) {
            const sql =
                `SELECT COUNT(id) AS referral_count FROM user WHERE referrer = ?`;

            const origin = origin_from_url(app.index_url);

            // only count the referral if the origin hashes to the app's uid
            const svc_auth = this.services.get('auth');
            const expected_uid = await svc_auth.app_uid_from_origin(origin);
            if ( expected_uid !== app.uid ) {
                continue;
            }

            const key_referral_count = `apps:referral_count:uid:${app.uid}`;
            const { referral_count } = (await db.read(
                `SELECT COUNT(id) AS referral_count FROM user WHERE referrer LIKE ?`,
                [origin + '%']
            ))[0];

            kv.set(key_referral_count, referral_count);
        }

        this.log.info('DONE refresh app stat referrals');
    }

    async _refresh_recent_cache () {
        const app_keys = kv.keys(`apps:uid:*`);
        // console.log('APP KEYS', app_keys);

        let apps = [];
        for ( const key of app_keys ) {
            const app = kv.get(key);
            apps.push(app);
        }

        apps = apps.filter(app => app.approved_for_listing);
        apps.sort((a, b) => {
            return b.timestamp - a.timestamp;
        });

        this.collections.recent = apps.map(app => app.uid).slice(0, 50);
    }

    async _refresh_tags () {
        const app_keys = kv.keys(`apps:uid:*`);
        // console.log('APP KEYS', app_keys);

        let apps = [];
        for ( const key of app_keys ) {
            const app = kv.get(key);
            apps.push(app);
        }

        apps = apps.filter(app => app.approved_for_listing);
        apps.sort((a, b) => {
            return b.timestamp - a.timestamp;
        });

        const new_tags = {};

        for ( const app of apps ) {
            const app_tags = (app.tags ?? '').split(',')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);

            for ( const tag of app_tags ) {
                if ( ! new_tags[tag] ) new_tags[tag] = {};
                new_tags[tag][app.uid] = true;
            }
        }

        for ( const tag in new_tags ) {
            new_tags[tag] = Object.keys(new_tags[tag]);
        }

        this.tags = new_tags;
    }

    async delete_app (app_uid, app) {
        const db = this.services.get('database').get(DB_READ, 'apps');

        app = app ?? kv.get('apps:uid:' + app_uid);
        if ( ! app ) {
            app = (await db.read(
                `SELECT * FROM apps WHERE uid = ?`,
                [app_uid]
            ))[0];
        }

        if ( ! app ) {
            throw new Error('app not found');
        }

        await db.write(
            `DELETE FROM apps WHERE uid = ? LIMIT 1`,
            [app_uid]
        );

        // remove from caches
        kv.del('apps:name:' + app.name);
        kv.del('apps:id:' + app.id);
        kv.del('apps:uid:' + app.uid);

        // remove from recent
        const index = this.collections.recent.indexOf(app_uid);
        if ( index >= 0 ) {
            this.collections.recent.splice(index, 1);
        }

        // remove from tags
        const app_tags = (app.tags ?? '').split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        for ( const tag of app_tags ) {
            if ( ! this.tags[tag] ) continue;
            const index = this.tags[tag].indexOf(app_uid);
            if ( index >= 0 ) {
                this.tags[tag].splice(index, 1);
            }
        }

    }
}

module.exports = {
    AppInformationService,
};
