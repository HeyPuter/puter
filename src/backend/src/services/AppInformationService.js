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
const { asyncSafeSetInterval } = require('@heyputer/putility').libs.promise;
const { MINUTE, SECOND } = require("@heyputer/putility").libs.time;
const { origin_from_url } = require("../util/urlutil");
const { DB_READ } = require("./database/consts");

const uuidv4 = require('uuid').v4;


/**
* @class AppInformationService
* @description
* The AppInformationService class manages application-related information,
* including caching, statistical data, and tags for applications within the Puter ecosystem.
* It provides methods for refreshing application data, managing app statistics,
* and handling tags associated with apps. This service is crucial for maintaining
* up-to-date information about applications, facilitating features like app listings,
* recent apps, and tag-based app discovery.
*/
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
            /**
            * Refreshes the application cache by querying the database for all apps and updating the key-value store.
            * 
            * This method is called periodically to ensure that the in-memory cache reflects the latest
            * state from the database. It uses the 'database' service to fetch app data and then updates
            * multiple cache entries for quick lookups by name, ID, and UID.
            *
            * @async
            */
            asyncSafeSetInterval(async () => {
                this._refresh_app_cache();
            }, 30 * 1000);

            await this._refresh_app_stats();
            /**
            * Refreshes the cache of recently opened apps.
            * This method updates the 'recent' collection with the UIDs of apps sorted by their most recent timestamp.
            * 
            * @async
            * @returns {Promise<void>} A promise that resolves when the cache has been refreshed.
            */
            asyncSafeSetInterval(async () => {
                this._refresh_app_stats();
            }, 120 * 1000);

            // This stat is more expensive so we don't update it as often
            await this._refresh_app_stat_referrals();
            /**
            * Refreshes the app referral statistics.
            * This method is computationally expensive and thus runs less frequently.
            * It queries the database for user counts referred by each app's origin URL.
            * 
            * @async
            */
            asyncSafeSetInterval(async () => {
                this._refresh_app_stat_referrals();
            }, 15 * MINUTE);

            await this._refresh_recent_cache();
            /**
            * Refreshes the recent cache by updating the list of recently added or updated apps.
            * This method fetches all app data, filters for approved apps, sorts them by timestamp,
            * and updates the `this.collections.recent` array with the UIDs of the most recent 50 apps.
            * 
            * @async
            * @private
            */
            asyncSafeSetInterval(async () => {
                this._refresh_recent_cache();
            }, 120 * 1000);

            await this._refresh_tags();
            /**
            * Refreshes the tags cache by iterating through all approved apps,
            * extracting their tags, and organizing them into a structured format.
            * This method updates the `this.tags` object with the latest tag information.
            *
            * @async
            * @method
            * @memberof AppInformationService
            */
            asyncSafeSetInterval(async () => {
                this._refresh_tags();
            } , 120 * 1000);
        })();
    }


    /**
    * Retrieves and returns statistical data for a specific application.
    * 
    * This method fetches various metrics such as the number of times the app has been opened,
    * the count of unique users who have opened the app, and the number of referrals attributed to the app.
    * It uses cached data where available to improve performance.
    *
    * @param {string} app_uid - The unique identifier for the application.
    * @returns {Promise<Object>} An object containing:
    *   - {number} open_count - The total number of times the app has been opened.
    *   - {number} user_count - The count of unique users who have opened the app.
    *   - {number|null} referral_count - The number of referrals, or null if the data is not available or too expensive to retrieve.
    */
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


    /**
    * Retrieves various statistics for a given app.
    * 
    * This method fetches the open count, user count, and referral count for an app identified by its UID.
    * It uses cached values where available to improve performance, but will query the database if necessary.
    * 
    * @param {string} app_uid - The unique identifier of the app for which to retrieve stats.
    * @returns {Promise<Object>} An object containing:
    *   - {number} open_count - Total number of times the app was opened.
    *   - {number} user_count - Number of unique users who opened the app.
    *   - {number|null} referral_count - Number of referrals attributed to the app. This value might not be reported if not cached.
    */
    async _refresh_app_cache () {
        this.log.tick('refresh app cache');

        const db = this.services.get('database').get(DB_READ, 'apps');

        let apps = await db.read('SELECT * FROM apps');
        for ( const app of apps ) {
            kv.set('apps:name:' + app.name, app);
            kv.set('apps:id:' + app.id, app);
            kv.set('apps:uid:' + app.uid, app);
        }
    }


    /**
    * Refreshes the application cache by querying the database for all apps and updating the key-value store.
    * 
    * @async
    * @returns {Promise<void>} A promise that resolves when the cache refresh operation is complete.
    * 
    * @notes
    * - This method logs a tick event for performance monitoring.
    * - It populates the cache with app data indexed by name, id, and uid.
    */
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


    /**
    * Refreshes the cache of app statistics including open and user counts.
    * This method updates the cache every 120 seconds to ensure data freshness.
    *
    * @async
    */
    async _refresh_app_stat_referrals () {
        this.log.tick('refresh app stat referrals');

        const db = this.services.get('database').get(DB_READ, 'apps');

        const apps = await db.read(`SELECT uid, index_url FROM apps`);

        for ( const app of apps ) {
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


    /**
    * Updates the cache with recently updated apps.
    * 
    * @description This method refreshes the cache containing the most recently updated applications.
    *              It fetches all app UIDs, retrieves the corresponding app data, filters for approved apps,
    *              sorts them by timestamp in descending order, and updates the 'recent' collection with
    *              the UIDs of the top 50 most recent apps.
    * 
    * @returns {Promise<void>} Resolves when the cache has been updated.
    */
    async _refresh_recent_cache () {
        const app_keys = kv.keys(`apps:uid:*`);

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


    /**
    * Refreshes the cache of recently added or updated apps.
    * 
    * This method retrieves all apps from the cache, filters for approved listings,
    * sorts them by timestamp in descending order, and updates the `recent` collection
    * with the UIDs of the most recent 50 apps.
    *
    * @returns {Promise<void>}
    */
    async _refresh_tags () {
        const app_keys = kv.keys(`apps:uid:*`);

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


    /**
    * Deletes an application from the system.
    * 
    * This method performs the following actions:
    * - Retrieves the app data from cache or database if not provided.
    * - Deletes the app record from the database.
    * - Removes the app from all relevant caches (by name, id, and uid).
    * - Removes the app from the recent collection if present.
    * - Removes the app from any associated tags.
    * 
    * @param {string} app_uid - The unique identifier of the app to be deleted.
    * @param {Object} [app] - The app object, if already fetched. If not provided, it will be retrieved.
    * @throws {Error} If the app is not found in either cache or database.
    * @returns {Promise<void>} A promise that resolves when the app has been successfully deleted.
    */
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
