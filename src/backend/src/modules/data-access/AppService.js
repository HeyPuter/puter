import BaseService from '../../services/BaseService.js';
import { DB_READ } from '../../services/database/consts.js';
import { Context } from '../../util/context.js';
import AppRepository from './AppRepository.js';
import { as_bool } from './lib/coercion.js';

/**
 * AppService contains an instance using the repository pattern
 */
export default class AppService extends BaseService {
    async _init () {
        this.repository = new AppRepository();
        this.db = this.services.get('database').get(DB_READ, 'apps');
    }

    static IMPLEMENTS = {
        ['crud-q']: {
            async create ({ object, options }) {
                // TODO
            },
            async update ({ object, id, options }) {
                // TODO
            },
            async upsert ({ object, id, options }) {
                // TODO
            },
            async read ({ uid, id, params = {} }) {
                // TODO
            },
            async select (options) {
                return this.#select(options);
            },
            async delete ({ uid, id }) {
                // TODO
            },
        },
    };

    async #select ({ predicate, ...rest }) {
        const db = this.db;

        if ( ! Array.isArray(predicate) ) throw new Error('predicate must be an array');

        const userCanEditOnly = Array.prototype.includes.call(predicate, 'user-can-edit');

        const stmt = `SELECT * FROM apps ${userCanEditOnly ? 'WHERE owner_user_id=?' : ''} LIMIT 5000`;
        const values = userCanEditOnly ? [Context.get('user').id] : [];
        const rows = await db.read(stmt, values);

        const client_safe_apps = [];
        for ( const row of rows ) {
            const app = {};

            // FROM ROW
            app.approved_for_incentive_program = as_bool(row.approved_for_incentive_program);
            app.approved_for_listing = as_bool(row.approved_for_listing);
            app.approved_for_opening_items = as_bool(row.approved_for_opening_items);
            app.background = as_bool(row.background);
            app.created_at = row.created_at;
            app.created_from_origin = row.created_from_origin;
            app.description = row.description;
            app.godmode = as_bool(row.godmode);
            app.icon = row.icon;
            app.index_url = row.index_url;
            app.maximize_on_start = as_bool(row.maximize_on_start);
            app.metadata = row.metadata;
            app.name = row.name;
            app.protected = as_bool(row.protected);
            app.stats = row.stats;
            app.title = row.title;
            app.uid = row.uid;

            // REQURIES OTHER DATA
            // app.app_owner;
            // app.filetype_associations = row.filetype_associations;
            // app.owner = row.owner;

            // REFINED BY OTHER DATA
            // app.icon;

            client_safe_apps.push(app);
        }

        return client_safe_apps;
    }
}
