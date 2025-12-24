import BaseService from '../../services/BaseService.js';
import { DB_READ } from '../../services/database/consts.js';
import { Context } from '../../util/context.js';
import AppRepository from './AppRepository.js';
import { as_bool } from './lib/coercion.js';
import { user_to_client } from './lib/filter.js';
import { extract_from_prefix } from './lib/sqlutil.js';

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

    async #select ({ predicate, params, ...rest }) {
        const db = this.db;

        if ( predicate === undefined ) predicate = [];
        if ( params === undefined ) params = {};
        if ( ! Array.isArray(predicate) ) throw new Error('predicate must be an array');

        const userCanEditOnly = Array.prototype.includes.call(predicate, 'user-can-edit');

        const sql_associatedFiletypes = this.db.case({
            mysql: 'COALESCE(JSON_ARRAYAGG(afa.type), JSON_ARRAY())',
            sqlite: "COALESCE(json_group_array(afa.type), json('[]'))",
        });

        const stmt = 'SELECT apps.*, ' +
            'owner_user.username AS owner_user_username, ' +
            'owner_user.uuid AS owner_user_uuid, ' +
            'app_owner.uid AS app_owner_uid, ' +
            `${sql_associatedFiletypes} AS filetypes ` +
            'FROM apps ' +
            'LEFT JOIN user owner_user ON apps.owner_user_id = owner_user.id ' +
            'LEFT JOIN apps app_owner ON apps.app_owner = app_owner.id ' +
            'LEFT JOIN app_filetype_association afa ON apps.id = afa.app_id ' +
            `${userCanEditOnly ? 'WHERE apps.owner_user_id=?' : ''} ` +
            'GROUP BY apps.id ' +
            'LIMIT 5000';
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

            app.app_owner = {
                uid: row.app_owner_uid,
            };

            {
                const owner_user = extract_from_prefix(row, 'owner_user_');
                app.owner_user = user_to_client(owner_user);
            }

            if ( typeof row.filetypes === 'string' ) {
                try {
                    const filetypesAsJSON = JSON.parse(row.filetypes);
                    for ( let i = 0 ; i < filetypesAsJSON.length ; i++ ) {
                        if ( filetypesAsJSON[i] === null ) continue;
                        if ( typeof filetypesAsJSON[i] !== 'string' ) {
                            throw new Error(`expected filetypesAsJSON[${i}] to be a string, got: ${filetypesAsJSON[i]}`);
                        }
                        if ( String.prototype.startsWith.call(filetypesAsJSON[i], '.') ) {
                            filetypesAsJSON[i] = filetypesAsJSON[i].slice(1);
                        }
                    }
                    app.filetype_associations = filetypesAsJSON;
                } catch (e) {
                    throw new Error(`failed to get app filetype associations: ${e.message}`, { cause: e });
                }
            }

            // REFINED BY OTHER DATA
            // app.icon;
            if ( params.icon_size ) {
                const icon_size = params.icon_size;
                const svc_appIcon = this.context.get('services').get('app-icon');
                try {
                    const icon_result = await svc_appIcon.get_icon_stream({
                        app_uid: row.uid,
                        app_icon: row.icon,
                        size: icon_size,
                    });
                    console.log('this is working it looks like');
                    app.icon = await icon_result.get_data_url();
                } catch (e) {
                    const svc_error = this.context.get('services').get('error-service');
                    svc_error.report('AppES:read_transform', { source: e });
                }
            }

            client_safe_apps.push(app);
        }

        return client_safe_apps;
    }
}
