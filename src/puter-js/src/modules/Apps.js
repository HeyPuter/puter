import * as utils from '../lib/utils.js';
import { fetchUrl } from '../lib/networkUtils.js';
import { fetchAllPages, iteratePages } from '../lib/pagination.js';

class Apps {
    /**
     * Creates a new instance with the given authentication token, API origin, and app ID,
     *
     * @class
     * @param {string} authToken - Token used to authenticate the user.
     * @param {string} APIOrigin - Origin of the API server. Used to build the API endpoint URLs.
     * @param {string} appID - ID of the app to use.
     */
    constructor (puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
        this.appID = puter.appID;
    }

    #addUserIterationToApp (app) {
        app.getUsers = async (params) => {
            params = params ?? {};
            return (await puter.drivers.call('app-telemetry', 'app-telemetry', 'get_users', { app_uuid: app.uid, limit: params.limit, offset: params.offset })).result;
        };
        app.users = async function* (pageSize = 100) {
            let offset = 0;

            while ( true ) {
                const users = await app.getUsers({ limit: pageSize, offset });

                if ( !users || users.length === 0 ) return;

                for ( const user of users ) {
                    yield user;
                }

                offset += users.length;
                if ( users.length < pageSize ) return;
            }
        };
        return app;
    }

    #addUserIterationToApps (apps) {
        apps.forEach(app => {
            this.#addUserIterationToApp(app);
        });
        return apps;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @memberof [Apps]
     * @returns {void}
     */
    setAuthToken (authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     *
     * @param {string} APIOrigin - The new API origin.
     * @memberof [Apps]
     * @returns {void}
     */
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    list = (...args) => {
        // if args is a single object, assume it is the options object.
        // Pagination keys (and `stream`) are lifted to top-level driver args;
        // the rest (icon_size, stats_period, ...) stay in `params`.
        const isObjectForm = typeof args[0] === 'object' && args[0] !== null;
        const opts = isObjectForm ? args[0] : {};
        const { limit, offset, cursor, includeTotal, stream, ...params } = opts;
        const hasCursor = Object.prototype.hasOwnProperty.call(opts, 'cursor');

        const select = utils.make_driver_method(['uid'], 'puter-apps', 'es:app', 'select');
        const base = { predicate: ['user-can-edit'] };
        if ( isObjectForm ) base.params = params;
        if ( limit !== undefined ) base.limit = limit;
        const fetchPage = pageParams => select.call(this, { ...base, ...pageParams });

        if ( stream === true ) {
            if ( offset !== undefined ) {
                throw { message: '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.', code: 'invalid_request' };
            }
            const self = this;
            return (async function* () {
                for await ( const page of iteratePages(fetchPage, { cursor, includeTotal: includeTotal === true }) ) {
                    self.#addUserIterationToApps(page.items ?? []);
                    yield page;
                }
            })();
        }

        // Any pagination param keeps the single-request behavior: a bare
        // (possibly limit-capped) array, or the page envelope once the
        // request opts into pagination via cursor/offset/includeTotal.
        if ( limit !== undefined || offset !== undefined || hasCursor || includeTotal !== undefined ) {
            return (async () => {
                const options = { ...base };
                if ( offset !== undefined ) options.offset = offset;
                if ( hasCursor ) options.cursor = cursor ?? null;
                if ( includeTotal !== undefined ) options.includeTotal = includeTotal;
                const result = await select.call(this, options);
                if ( result && !Array.isArray(result) && Array.isArray(result.items) ) {
                    this.#addUserIterationToApps(result.items);
                    return result;
                }
                return this.#addUserIterationToApps(result);
            })();
        }

        // Unbound listing: fetch page by page under the hood so no single
        // request carries the whole result, then return the legacy array.
        return fetchAllPages(fetchPage).then(items => this.#addUserIterationToApps(items));
    };

    create = async (...args) => {
        let options = {};
        // * allows for: puter.apps.new('example-app') *
        if ( typeof args[0] === 'string' ) {
            let indexURL = args[1];
            let title = args[2] ?? args[0];

            options = {
                object: {
                    name: args[0],
                    index_url: indexURL,
                    title: title,
                },
            };
        }

        // * allows for: puter.apps.new({name: 'example-app', indexURL: 'https://example.com'}) *
        else if ( typeof args[0] === 'object' && args[0] !== null ) {
            let options_raw = args[0];

            options = {
                object: {
                    name: options_raw.name,
                    index_url: options_raw.indexURL,
                    // title is optional only if name is provided.
                    // If title is provided, use it. If not, use name.
                    title: options_raw.title ?? options_raw.name,
                    description: options_raw.description,
                    icon: options_raw.icon,
                    maximize_on_start: options_raw.maximizeOnStart,
                    background: options_raw.background,
                    filetype_associations: options_raw.filetypeAssociations,
                    metadata: options_raw.metadata,
                },
                options: {
                    dedupe_name: options_raw.dedupeName ?? false,
                },
            };
        }

        // name and indexURL are required
        if ( ! options.object.name ) {
            throw {
                success: false,
                error: {
                    code: 'invalid_request',
                    message: 'Name is required',
                },
            };
        }
        if ( ! options.object.index_url ) {
            throw {
                success: false,
                error: {
                    code: 'invalid_request',
                    message: 'Index URL is required',
                },
            };
        }

        // Call the original chat.complete method
        return this.#addUserIterationToApp(await utils.make_driver_method(['object'], 'puter-apps', 'es:app', 'create').call(this, options));
    };

    update = async (...args) => {
        let options = {};

        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.update('example-app') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            let object_raw = args[1];
            let object = {
                name: object_raw.name,
                index_url: object_raw.indexURL,
                title: object_raw.title,
                description: object_raw.description,
                icon: object_raw.icon,
                maximize_on_start: object_raw.maximizeOnStart,
                background: object_raw.background,
                filetype_associations: object_raw.filetypeAssociations,
                metadata: object_raw.metadata,
            };

            options = { id: { name: args[0] }, object: object };
        }

        // Call the original chat.complete method
        return this.#addUserIterationToApp(await utils.make_driver_method(['object'], 'puter-apps', 'es:app', 'update').call(this, options));
    };

    get = async (...args) => {
        let options = {};

        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.get('example-app') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            // if second argument is an object, assume it is the options object
            if ( typeof args[1] === 'object' && args[1] !== null ) {
                options.params = args[1];
            }
            // name
            options.id = { name: args[0] };
        }

        // if first argument is an object, assume it is the options object
        if ( typeof args[0] === 'object' && args[0] !== null ) {
            options.params = args[0];
        }
        return this.#addUserIterationToApp(await utils.make_driver_method(['uid'], 'puter-apps', 'es:app', 'read').call(this, options));
    };

    delete = async (...args) => {
        let options = {};
        // if there is one string argument, assume it is the app name
        // * allows for: puter.apps.get('example-app') *
        if ( Array.isArray(args) && typeof args[0] === 'string' ) {
            options = { id: { name: args[0] } };
        }
        return utils.make_driver_method(['uid'], 'puter-apps', 'es:app', 'delete').call(this, options);
    };

    checkName = async (name) => {
        if ( typeof name !== 'string' || name.length === 0 ) {
            throw {
                success: false,
                error: {
                    code: 'invalid_request',
                    message: 'Name is required',
                },
            };
        }

        const resp = await fetchUrl(
            `${puter.APIOrigin}/apps/nameAvailable?name=${encodeURIComponent(name)}`,
            { includePuterAuth: true },
        );
        const result = await resp.json();
        if ( ! resp.ok ) {
            throw result;
        }
        return result;
    };

    getDeveloperProfile = function (...args) {
        let options;

        // If first argument is an object, it's the options
        if ( typeof args[0] === 'object' && args[0] !== null ) {
            options = args[0];
        } else {
            // Otherwise, we assume separate arguments are provided
            options = {
                success: args[0],
                error: args[1],
            };
        }

        return new Promise((resUpper, rejUpper) => {
            let options;

            // If first argument is an object, it's the options
            if ( typeof args[0] === 'object' && args[0] !== null ) {
                options = args[0];
            } else {
                // Otherwise, we assume separate arguments are provided
                options = {
                    success: args[0],
                    error: args[1],
                };
            }

            return new Promise((resolve, reject) => {
                const xhr = utils.initXhr('/get-dev-profile', puter.APIOrigin, puter.authToken, 'get');

                // set up event handlers for load and error events
                utils.setupXhrEventHandlers(xhr, options.success ?? resUpper, options.error ?? rejUpper, resolve, reject);

                xhr.send();
            });
        });
    };
}

export default Apps;
