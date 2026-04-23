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
const APIError = require('../../api/APIError');
const { AppRedisCacheSpace } = require('../../modules/apps/AppRedisCacheSpace.js');
const { deleteRedisKeys } = require('../../clients/redis/deleteRedisKeys.js');
const config = require('../../config');
const { app_name_exists } = require('../../helpers');
const { AppUnderUserActorType } = require('../../services/auth/Actor');
const { DB_WRITE } = require('../../services/database/consts');
const { Context } = require('../../util/context');
const { origin_from_url } = require('../../util/urlutil');
const { Eq, Like, Or, And } = require('../query/query');
const { BaseES } = require('./BaseES');
const { Entity } = require('./Entity');

const uuidv4 = require('uuid').v4;
const APP_UID_ALIAS_KEY_PREFIX = 'app:canonicalUidAlias';
const APP_UID_ALIAS_REVERSE_KEY_PREFIX = 'app:canonicalUidAliasReverse';
const APP_UID_ALIAS_TTL_SECONDS = 60 * 60 * 24 * 90;
const APP_OBJECT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const indexUrlUniquenessExemptionCandidates =  [
    'https://dev-center.puter.com/coming-soon',
];
const hasIndexUrlUniquenessExemption = (candidates) => {
    for ( const candidate of candidates ) {
        if ( indexUrlUniquenessExemptionCandidates.find(exception => candidate.startsWith(exception)) ) {
            return true;
        }
    }
    return false;
};

const normalizeConfiguredHostedDomain = (domainValue) => {
    if ( typeof domainValue !== 'string' ) return null;
    const normalizedDomainValue = domainValue.trim().toLowerCase().replace(/^\./, '');
    if ( ! normalizedDomainValue ) return null;
    return normalizedDomainValue.split(':')[0] || null;
};

const getConfiguredHostedDomains = () => {
    const hostedDomains = new Set();
    for ( const configuredDomain of [
        config.static_hosting_domain,
        config.static_hosting_domain_alt,
        config.private_app_hosting_domain,
        config.private_app_hosting_domain_alt,
    ] ) {
        const normalizedDomain = normalizeConfiguredHostedDomain(configuredDomain);
        if ( normalizedDomain ) {
            hostedDomains.add(normalizedDomain);
        }
    }
    return [...hostedDomains];
};

const extractPuterHostedSubdomainFromIndexUrl = (indexUrl) => {
    if ( typeof indexUrl !== 'string' || !indexUrl ) return null;

    let hostname;
    try {
        hostname = (new URL(indexUrl)).hostname.toLowerCase();
    } catch {
        return null;
    }

    const hostedDomains = getConfiguredHostedDomains()
        .sort((domainA, domainB) => domainB.length - domainA.length);

    for ( const hostedDomain of hostedDomains ) {
        const suffix = `.${hostedDomain}`;
        if ( hostname.endsWith(suffix) ) {
            const subdomain = hostname.slice(0, hostname.length - suffix.length);
            return subdomain || null;
        }
    }

    return null;
};

let privateLaunchAccessModulePromise;
const getPrivateLaunchAccessModule = async () => {
    if ( ! privateLaunchAccessModulePromise ) {
        privateLaunchAccessModulePromise = import('../../modules/apps/privateLaunchAccess.js');
    }
    return privateLaunchAccessModulePromise;
};

class AppES extends BaseES {
    static METHODS = {
        async _on_context_provided () {
            const services = this.context.get('services');
            this.db = services.get('database').get(DB_WRITE, 'apps');
        },

        /**
         * Creates query predicates for filtering apps
         * @param {string} id - Predicate identifier
         * @param {...any} args - Additional arguments for predicate creation
         * @returns {Promise<Eq|Like>} Query predicate object
         */
        async create_predicate (id, ...args) {
            if ( id === 'user-can-edit' ) {
                return new Eq({
                    key: 'owner',
                    value: Context.get('user').id,
                });
            }
            if ( id === 'name-like' ) {
                return new Like({
                    key: 'name',
                    value: args[0],
                });
            }
        },
        async delete (uid, _extra) {
            const svc_appInformation = this.context.get('services').get('app-information');
            await svc_appInformation.delete_app(uid);
        },

        async read (uid) {
            if ( typeof uid !== 'string' || !uid ) {
                return await this.upstream.read(uid);
            }

            const canonicalUidAliasPromise = this.read_canonical_app_uid_alias_(uid);
            const entity = await this.upstream.read(uid);
            if ( entity ) {
                return entity;
            }

            const canonicalUid = await canonicalUidAliasPromise;
            if ( !canonicalUid || canonicalUid === uid ) {
                return null;
            }

            return await this.upstream.read(canonicalUid);
        },

        /**
         * Filters app selection based on user permissions and visibility settings
         * @param {Object} options - Selection options including predicates
         * @returns {Promise<Object>} Filtered selection results
         */
        async select (options) {
            const actor = Context.get('actor');
            const user = actor.type.user;

            const additional = [];

            // An app is also allowed to read itself
            if ( actor.type instanceof AppUnderUserActorType ) {
                additional.push(new Eq({
                    key: 'uid',
                    value: actor.type.app.uid,
                }));
            }

            options.predicate = options.predicate.and(new Or({
                children: [
                    new Eq({
                        key: 'approved_for_listing',
                        value: 1,
                    }),
                    new Eq({
                        key: 'owner',
                        value: user.id,
                    }),
                    ...additional,
                ],
            }));

            return await this.upstream.select(options);
        },

        /**
         * Creates or updates an application with proper name handling and associations
         * @param {Object} entity - Application entity to upsert
         * @param {Object} extra - Additional upsert parameters
         * @returns {Promise<Object>} Upsert operation results
         */
        async upsert (entity, extra) {
            extra = extra || {};
            const actor = Context.get('actor');
            const user = actor?.type?.user;

            const preJoinFullEntity = extra.old_entity
                ? await (await extra.old_entity.clone()).apply(entity)
                : entity
                ;
            await this.ensurePuterSiteSubdomainIsOwned(preJoinFullEntity, extra, user);

            await this.maybe_join_owned_hosted_index_url_app_on_create_(entity, extra, user);

            const full_entity = extra.old_entity
                ? await (await extra.old_entity.clone()).apply(entity)
                : entity
                ;

            await this.ensureIndexUrlUnique(full_entity, extra);

            if ( await app_name_exists(await entity.get('name')) ) {
                const { old_entity } = extra;
                const is_name_change = ( !old_entity ) ||
                    ( await old_entity.get('name') !== await entity.get('name') );
                if ( is_name_change && extra?.options?.dedupe_name ) {
                    const base = await entity.get('name');
                    let number = 1;
                    while ( await app_name_exists(`${base}-${number}`) ) {
                        number++;
                    }
                    await entity.set('name', `${base}-${number}`);
                }
                else if ( is_name_change ) {
                    // The name might be taken because it's the old name
                    // of this same app. If it is, the app takes it back.
                    const svc_oldAppName = this.context.get('services').get('old-app-name');
                    const name_info = await svc_oldAppName.check_app_name(await entity.get('name'));
                    if ( !name_info || name_info.app_uid !== await entity.get('uid') ) {
                        // Throw error because the name really is taken
                        throw APIError.create('app_name_already_in_use', null, {
                            name: await entity.get('name'),
                        });
                    }

                    // Remove the old name from the old-app-name service
                    await svc_oldAppName.remove_name(name_info.id);
                } else {
                    entity.del('name');
                }
            }

            const subdomain_id = await this.maybe_insert_subdomain_(entity);
            const result = await this.upstream.upsert(entity, extra);
            const { insert_id } = result;
            const oldAssociations = await this.db.read(
                'SELECT type FROM app_filetype_association WHERE app_id = ?',
                [insert_id],
            );
            const normalizedOldAssociations = oldAssociations
                .map(row => String(row.type ?? '').trim().toLowerCase().replace(/^\./, ''))
                .filter(Boolean);

            // Remove old file associations (if applicable)
            if ( extra.old_entity ) {
                await this.db.write(
                    'DELETE FROM app_filetype_association WHERE app_id = ?',
                    [insert_id],
                );
            }

            // Add file associations (if applicable)
            const filetype_associations = await entity.get('filetype_associations');
            const normalizedNewAssociations = (filetype_associations ?? [])
                .map(association => String(association).trim().toLowerCase().replace(/^\./, ''))
                .filter(Boolean);
            if ( (a => a && a.length > 0)(filetype_associations) ) {
                const stmt =
                    'INSERT INTO app_filetype_association ' +
                    `(app_id, type) VALUES ${
                        normalizedNewAssociations.map(() => '(?, ?)').join(', ')}`;
                const rows = normalizedNewAssociations.map(a => [insert_id, a]);
                await this.db.write(stmt, rows.flat());
            }
            const affectedAssociationExtensions = new Set([
                ...normalizedOldAssociations,
                ...normalizedNewAssociations,
            ]);
            if ( affectedAssociationExtensions.size ) {
                await deleteRedisKeys(Array.from(affectedAssociationExtensions)
                    .map(ext => AppRedisCacheSpace.associationAppsKey(ext)));
            }

            const has_new_icon =
                ( !extra.old_entity ) || (
                    await entity.get('icon') !== await extra.old_entity.get('icon')
                );

            if ( has_new_icon ) {
                const svc_event = this.context.get('services').get('event');
                const event = {
                    app_uid: await entity.get('uid'),
                    data_url: await entity.get('icon'),
                    url: '',
                };
                await svc_event.emit('app.new-icon', event);
                if ( typeof event.url === 'string' && event.url ) {
                    await this.db.write(
                        'UPDATE apps SET icon = ? WHERE id = ? LIMIT 1',
                        [event.url, insert_id],
                    );
                    await entity.set('icon', event.url);
                }
            }

            const has_new_name =
                extra.old_entity && (
                    await entity.get('name') !== await extra.old_entity.get('name')
                );

            if ( has_new_name ) {
                const svc_event = this.context.get('services').get('event');
                const event = {
                    app_uid: await entity.get('uid'),
                    new_name: await entity.get('name'),
                    old_name: await extra.old_entity.get('name'),
                };
                await svc_event.emit('app.rename', event);
            }

            // Associate app with subdomain (if applicable)
            if ( subdomain_id ) {
                await this.db.write(
                    'UPDATE subdomains SET associated_app_id = ? WHERE id = ?',
                    [insert_id, subdomain_id],
                );
            }
            if ( extra.old_entity ) {
                const svc_event = this.context.get('services').get('event');
                const [app] = await this.db.read(
                    'SELECT * FROM apps WHERE uid = ? LIMIT 1',
                    [await full_entity.get('uid')],
                );
                const old_app = {
                    uid: await extra.old_entity.get('uid'),
                    index_url: await extra.old_entity.get('index_url'),
                };
                await svc_event.emit('app.changed', {
                    app_uid: await full_entity.get('uid'),
                    action: 'updated',
                    app,
                    old_app,
                });
            }

            if ( extra.joined_source_app_uid ) {
                await this.write_canonical_app_uid_alias_({
                    oldAppUid: extra.joined_source_app_uid,
                    canonicalAppUid: await full_entity.get('uid'),
                });
                const svc_appInformation = this.context.get('services').get('app-information');
                if ( svc_appInformation?.delete_app ) {
                    await svc_appInformation.delete_app(extra.joined_source_app_uid, undefined, {
                        preserveCanonicalUidAlias: true,
                    });
                }
            }

            if ( typeof extra.joined_requested_name === 'string' && extra.joined_requested_name.trim() ) {
                const renameResult = await this.apply_joined_requested_name_({
                    canonicalUid: await full_entity.get('uid'),
                    requestedName: extra.joined_requested_name,
                });
                if ( renameResult ) {
                    const svc_event = this.context.get('services').get('event');
                    await svc_event.emit('app.rename', {
                        app_uid: await full_entity.get('uid'),
                        old_name: renameResult.oldName,
                        new_name: renameResult.newName,
                    });
                    await full_entity.set('name', renameResult.newName);
                }
            }

            return result;
        },
        async retry_predicate_rewrite ({ predicate }) {
            const recurse = async (predicate) => {
                if ( predicate instanceof Or ) {
                    return new Or({
                        children: await Promise.all(predicate.children.map(recurse)),
                    });
                }
                if ( predicate instanceof And ) {
                    return new And({
                        children: await Promise.all(predicate.children.map(recurse)),
                    });
                }
                if ( predicate instanceof Eq ) {
                    if ( predicate.key === 'name' ) {
                        const svc_oldAppName = this.context.get('services').get('old-app-name');
                        const name_info = await svc_oldAppName.check_app_name(predicate.value);
                        return new Eq({
                            key: 'uid',
                            value: name_info?.app_uid,
                        });
                    }
                }
            };
            return await recurse(predicate);
        },

        async queueIconMigration (entity) {
            if ( ! this.pending_icon_migrations_ ) {
                this.pending_icon_migrations_ = new Set();
            }

            const migration_key = entity.private_meta?.mysql_id ?? Symbol('app-icon-migration');
            if ( this.pending_icon_migrations_.has(migration_key) ) {
                return;
            }
            this.pending_icon_migrations_.add(migration_key);

            Promise.resolve().then(async () => {
                const icon = await entity.get('icon');
                if ( typeof icon !== 'string' || !icon.startsWith('data:') ) {
                    return;
                }

                const app_uid = await entity.get('uid');
                if ( ! app_uid ) {
                    return;
                }

                const svc_event = this.context.get('services').get('event');
                const event = {
                    app_uid,
                    data_url: icon,
                };
                await svc_event.emit('app.new-icon', event);
                if ( typeof event.url !== 'string' || !event.url ) return;

                await this.db.write(
                    'UPDATE apps SET icon = ? WHERE uid = ? LIMIT 1',
                    [event.url, app_uid],
                );
            }).catch(e => {
                const svc_error = this.context.get('services').get('error-service');
                svc_error.report('AppES:queue_icon_migration', { source: e });
            }).finally(() => {
                this.pending_icon_migrations_.delete(migration_key);
            });
        },

        async get_cached_app_object_ (appUid) {
            if ( typeof appUid !== 'string' || !appUid ) return null;
            return await AppRedisCacheSpace.getCachedAppObject({
                lookup: 'uid',
                value: appUid,
            });
        },

        async set_cached_app_object_ (entity) {
            if ( ! entity ) return;

            const cacheable = await entity.get_client_safe();
            delete cacheable.stats;
            delete cacheable.privateAccess;

            await AppRedisCacheSpace.setCachedAppObject(cacheable, {
                ttlSeconds: APP_OBJECT_CACHE_TTL_SECONDS,
            });
        },

        /**
         * Transforms app data before reading by adding associations and handling permissions
         * @param {Object} entity - App entity to transform
         */
        async read_transform (entity) {
            const {
                getActorUserUid,
                resolvePrivateLaunchAccess,
            } = await getPrivateLaunchAccessModule();
            const services = this.context.get('services');
            const actor = Context.get('actor');
            const esParams = Context.get('es_params') ?? {};
            const appUid = await entity.get('uid');
            const appName = await entity.get('name');
            const appIndexUrl = await entity.get('index_url');
            const appCreatedAt = await entity.get('created_at');
            const appIsPrivate = await entity.get('is_private');
            const cachedAppObject = await this.get_cached_app_object_(appUid);

            const appInformationService = services.get('app-information');
            const authService = services.get('auth');
            const statsPromise = appInformationService
                ? appInformationService.get_stats(appUid, {
                    period: esParams.stats_period,
                    grouping: esParams.stats_grouping,
                    created_at: appCreatedAt,
                })
                : Promise.resolve(undefined);
            const cachedFiletypeAssociations = Array.isArray(cachedAppObject?.filetype_associations)
                ? cachedAppObject.filetype_associations
                : null;
            const hasCachedCreatedFromOrigin = !!(
                cachedAppObject &&
                Object.prototype.hasOwnProperty.call(cachedAppObject, 'created_from_origin')
            );
            const shouldRefreshCachedAppObject =
                !cachedAppObject ||
                !cachedFiletypeAssociations ||
                !hasCachedCreatedFromOrigin;
            const fileAssociationsPromise = cachedFiletypeAssociations
                ? Promise.resolve(cachedFiletypeAssociations)
                : this.db.read(
                    'SELECT type FROM app_filetype_association WHERE app_id = ?',
                    [entity.private_meta.mysql_id],
                ).then(rows => rows.map(row => row.type));
            const createdFromOriginPromise = hasCachedCreatedFromOrigin
                ? Promise.resolve(cachedAppObject.created_from_origin ?? null)
                : (async () => {
                    if ( ! authService ) return null;
                    try {
                        const origin = origin_from_url(appIndexUrl);
                        const expectedUid = await authService.app_uid_from_origin(origin);
                        return expectedUid === appUid ? origin : null;
                    } catch {
                        // This happens when index_url is not a valid URL.
                        return null;
                    }
                })();
            const privateAccessPromise = resolvePrivateLaunchAccess({
                app: {
                    uid: appUid,
                    name: appName,
                    is_private: appIsPrivate,
                },
                services,
                userUid: getActorUserUid(actor),
                source: 'driverRead',
                args: esParams,
            });

            const [
                filetypeAssociations,
                stats,
                createdFromOrigin,
                privateAccess,
            ] = await Promise.all([
                fileAssociationsPromise,
                statsPromise,
                createdFromOriginPromise,
                privateAccessPromise,
            ]);
            await entity.set('filetype_associations', filetypeAssociations);
            await entity.set('stats', stats);
            await entity.set('created_from_origin', createdFromOrigin);
            await entity.set('privateAccess', privateAccess);
            if ( shouldRefreshCachedAppObject ) {
                await this.set_cached_app_object_(entity);
            }

            // Migrate b64 icons to the filesystem-backed icon flow without blocking reads.
            this.queueIconMigration(entity);

            // Check if the user is the owner
            const is_owner = await (async () => {
                let owner = await entity.get('owner');

                // TODO: why does this happen?
                if ( typeof owner === 'number' ) {
                    owner = { id: owner };
                }

                if ( ! owner ) return false;
                const actor = Context.get('actor');
                return actor.type.user.id === owner.id;
            })();

            // Remove fields that are not allowed for non-owners
            if ( ! is_owner ) {
                entity.del('approved_for_listing');
                entity.del('approved_for_opening_items');
                entity.del('approved_for_incentive_program');
            }

            // Replace icon if an icon size is specified
            const iconSize = Context.get('es_params')?.icon_size;
            if ( iconSize ) {
                const svc_appIcon = this.context.get('services').get('app-icon');
                try {
                    const iconPath = svc_appIcon.getAppIconPath({
                        appUid: await entity.get('uid'),
                        size: iconSize,
                    });
                    if ( iconPath ) {
                        await entity.set('icon', iconPath);
                    }
                } catch (e) {
                    const svc_error = this.context.get('services').get('error-service');
                    svc_error.report('AppES:read_transform', { source: e });
                }
            }
        },

        /**
         * Creates a subdomain entry for the app if required
         * @param {Object} entity - App entity
         * @returns {Promise<number|undefined>} Subdomain ID if created
         * @private
         */
        async maybe_insert_subdomain_ (entity) {
            // Create and update is a situation where we might create a subdomain

            let subdomain_id;
            if ( await entity.get('source_directory') ) {
                await (await entity.get('source_directory')
                ).fetchEntry();
                const subdomain = await entity.get('subdomain');
                const user = Context.get('user');
                let subdomain_res = await this.db.write(
                    `INSERT ${this.db.case({
                        mysql: 'IGNORE',
                        sqlite: 'OR IGNORE',
                    })} INTO subdomains
                    (subdomain, user_id, root_dir_id,   uuid) VALUES
                    (        ?,       ?,           ?,      ?)`,
                    [
                    //subdomain
                        subdomain,
                        //user_id
                        user.id,
                        //root_dir_id
                        (await entity.get('source_directory')).mysql_id,
                        //uuid, `sd` stands for subdomain
                        `sd-${ uuidv4()}`,
                    ],
                );
                subdomain_id = subdomain_res.insertId;
            }

            return subdomain_id;
        },

        /**
         * Ensures that when an app uses a puter.site subdomain as its index_url,
         * the subdomain belongs to the user creating/updating the app.
         */
        async ensurePuterSiteSubdomainIsOwned (entity, extra, user) {
            if ( ! user ) return;

            // Only enforce when the index_url is being set or changed
            const new_index_url = await entity.get('index_url');
            if ( ! new_index_url ) return;
            if ( extra.old_entity ) {
                const old_index_url = await extra.old_entity.get('index_url');
                if ( old_index_url === new_index_url ) {
                    return;
                }
            }

            const subdomain = extractPuterHostedSubdomainFromIndexUrl(new_index_url);
            if ( ! subdomain ) return;

            const svc_puterSite = this.context.get('services').get('puter-site');
            const site = await svc_puterSite.get_subdomain(subdomain, { is_custom_domain: false });

            if ( !site || site.user_id !== user.id ) {
                throw APIError.create('subdomain_not_owned', null, { subdomain });
            }
        },

        is_puter_hosted_index_url_ (index_url) {
            return !!extractPuterHostedSubdomainFromIndexUrl(index_url);
        },

        build_equivalent_index_url_candidates_ (index_url) {
            if ( typeof index_url !== 'string' || !index_url.trim() ) {
                return [];
            }

            try {
                const parsedUrl = new URL(index_url);
                const origin = `${parsedUrl.protocol}//${parsedUrl.host.toLowerCase()}`;
                const pathname = parsedUrl.pathname || '/';
                const values = new Set();
                if ( pathname === '/' || pathname.toLowerCase() === '/index.html' ) {
                    values.add(origin);
                    values.add(`${origin}/`);
                    values.add(`${origin}/index.html`);
                } else {
                    const normalizedPath = pathname.endsWith('/')
                        ? pathname.slice(0, -1)
                        : pathname;
                    values.add(`${origin}${normalizedPath}`);
                    values.add(`${origin}${normalizedPath}/`);
                }
                return [...values];
            } catch {
                return [index_url.trim()];
            }
        },

        async find_index_url_conflict_ ({ indexUrl, excludeMysqlId }) {
            if ( ! this.is_puter_hosted_index_url_(indexUrl) ) {
                return null;
            }

            const candidates = this.build_equivalent_index_url_candidates_(indexUrl);
            if ( candidates.length === 0 ) return null;
            if ( hasIndexUrlUniquenessExemption(candidates) ) return null;

            const placeholders = candidates.map(() => '?').join(', ');
            const parameters = [...candidates];
            let query = `SELECT id, uid, owner_user_id, index_url FROM apps WHERE index_url IN (${placeholders})`;
            if ( Number.isInteger(excludeMysqlId) && excludeMysqlId > 0 ) {
                query += ' AND id != ?';
                parameters.push(excludeMysqlId);
            }
            query += ' ORDER BY timestamp ASC, id ASC LIMIT 1';

            const rows = await this.db.read(query, parameters);
            const normalizedExcludeMysqlId = Number(excludeMysqlId);
            const conflictRow = rows.find(row => {
                if (
                    Number.isInteger(normalizedExcludeMysqlId)
                    && normalizedExcludeMysqlId > 0
                    && Number(row?.id) === normalizedExcludeMysqlId
                ) {
                    return false;
                }
                if ( typeof row?.index_url === 'string' ) {
                    return candidates.includes(row.index_url);
                }
                return true;
            });
            return conflictRow || null;
        },

        async resolve_entity_mysql_id_ (entity) {
            const directMysqlId = Number(entity?.private_meta?.mysql_id);
            if ( Number.isInteger(directMysqlId) && directMysqlId > 0 ) {
                return directMysqlId;
            }

            if ( !entity || typeof entity.get !== 'function' ) {
                return undefined;
            }

            const uid = await entity.get('uid');
            if ( typeof uid !== 'string' || !uid ) {
                return undefined;
            }

            const rows = await this.db.read(
                'SELECT id FROM apps WHERE uid = ? LIMIT 1',
                [uid],
            );
            const mysqlId = Number(rows?.[0]?.id);
            if ( Number.isInteger(mysqlId) && mysqlId > 0 ) {
                return mysqlId;
            }

            return undefined;
        },

        async claim_app_ownership_by_id_for_user_ ({ appId, userId }) {
            if ( !Number.isInteger(appId) || appId <= 0 ) return;
            if ( !Number.isInteger(userId) || userId <= 0 ) return;

            await this.db.write(
                'UPDATE apps SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL',
                [userId, appId],
            );
        },

        build_canonical_app_uid_alias_key_ (oldAppUid) {
            return `${APP_UID_ALIAS_KEY_PREFIX}:${oldAppUid}`;
        },

        build_canonical_app_uid_alias_reverse_key_ (canonicalAppUid) {
            return `${APP_UID_ALIAS_REVERSE_KEY_PREFIX}:${canonicalAppUid}`;
        },

        normalize_canonical_alias_uid_list_ (value) {
            if ( ! Array.isArray(value) ) return [];
            const normalizedList = [];
            const seen = new Set();
            for ( const item of value ) {
                if ( typeof item !== 'string' || !item ) continue;
                if ( seen.has(item) ) continue;
                seen.add(item);
                normalizedList.push(item);
            }
            return normalizedList;
        },

        async read_canonical_app_uid_alias_ (oldAppUid) {
            if ( typeof oldAppUid !== 'string' || !oldAppUid ) return null;

            const services = this.context.get('services');
            const kvStore = services.get('puter-kvstore');
            const suService = services.get('su');
            if ( !kvStore || typeof kvStore.get !== 'function' ) return null;
            if ( !suService || typeof suService.sudo !== 'function' ) return null;

            const key = this.build_canonical_app_uid_alias_key_(oldAppUid);
            try {
                const canonicalAppUid = await suService.sudo(() => kvStore.get({ key }));
                if ( typeof canonicalAppUid === 'string' && canonicalAppUid ) {
                    return canonicalAppUid;
                }
            } catch {
                // Alias reads are best-effort.
            }
            return null;
        },

        async write_canonical_app_uid_alias_ ({ oldAppUid, canonicalAppUid }) {
            if ( typeof oldAppUid !== 'string' || !oldAppUid ) return;
            if ( typeof canonicalAppUid !== 'string' || !canonicalAppUid ) return;
            if ( oldAppUid === canonicalAppUid ) return;

            const services = this.context.get('services');
            const kvStore = services.get('puter-kvstore');
            const suService = services.get('su');
            if ( !kvStore || typeof kvStore.set !== 'function' ) return;
            if ( !suService || typeof suService.sudo !== 'function' ) return;

            const key = this.build_canonical_app_uid_alias_key_(oldAppUid);
            const reverseKey = this.build_canonical_app_uid_alias_reverse_key_(canonicalAppUid);
            const expireAt = Math.floor(Date.now() / 1000) + APP_UID_ALIAS_TTL_SECONDS;
            try {
                await suService.sudo(async () => {
                    const reverseValue = await kvStore.get({ key: reverseKey });
                    const reverseAliases = this.normalize_canonical_alias_uid_list_(reverseValue);
                    if ( ! reverseAliases.includes(oldAppUid) ) {
                        reverseAliases.push(oldAppUid);
                    }

                    await kvStore.set({
                        key,
                        value: canonicalAppUid,
                        expireAt,
                    });
                    await kvStore.set({
                        key: reverseKey,
                        value: reverseAliases,
                        expireAt,
                    });
                });
            } catch {
                // Alias writes are best-effort.
            }
        },

        async maybe_join_owned_hosted_index_url_app_on_create_ (entity, extra, user) {
            if ( ! user ) return;

            const new_index_url = await entity.get('index_url');
            const source_entity = extra.old_entity;
            const currentMysqlId = await this.resolve_entity_mysql_id_(extra.old_entity);
            const conflictRow = await this.find_index_url_conflict_({
                indexUrl: new_index_url,
                excludeMysqlId: currentMysqlId,
            });
            if ( ! conflictRow ) return;

            const conflictOwnerUserId = Number(conflictRow.owner_user_id);
            if (
                Number.isInteger(conflictOwnerUserId)
                && conflictOwnerUserId > 0
                && conflictOwnerUserId !== user.id
            ) {
                throw APIError.create('app_index_url_already_in_use', null, {
                    index_url: new_index_url,
                    app_uid: conflictRow.uid,
                });
            }

            if ( !Number.isInteger(conflictOwnerUserId) || conflictOwnerUserId <= 0 ) {
                await this.claim_app_ownership_by_id_for_user_({
                    appId: conflictRow.id,
                    userId: user.id,
                });
            }

            const old_entity = await this.upstream.read(conflictRow.uid);
            const owner = await old_entity?.get('owner');
            let ownerUserId = owner?.id ?? owner;
            if ( owner instanceof Entity ) {
                ownerUserId = owner.private_meta.mysql_id;
            }
            ownerUserId = Number(ownerUserId);
            if ( !old_entity || !Number.isInteger(ownerUserId) || ownerUserId !== user.id ) {
                throw APIError.create('app_index_url_already_in_use', null, {
                    index_url: new_index_url,
                    app_uid: conflictRow.uid,
                });
            }
            if (
                Number.isInteger(conflictOwnerUserId)
                && conflictOwnerUserId === user.id
                && !await this.is_origin_bootstrap_app_entity_(old_entity)
            ) {
                // Prevent merging arbitrary same-owner apps; only allow the
                // auto-created origin bootstrap app to be absorbed.
                throw APIError.create('app_index_url_already_in_use', null, {
                    index_url: new_index_url,
                    app_uid: conflictRow.uid,
                });
            }

            if ( source_entity ) {
                const sourceUid = await source_entity.get('uid');
                const targetUid = await old_entity.get('uid');
                const requestedName = await entity.get('name');

                if (
                    sourceUid
                    && targetUid
                    && sourceUid !== targetUid
                    && requestedName !== undefined
                ) {
                    entity.del('name');
                    if ( typeof requestedName === 'string' && requestedName.trim() ) {
                        extra.joined_requested_name = requestedName.trim();
                    }
                }

                if ( sourceUid && targetUid && sourceUid !== targetUid ) {
                    extra.joined_source_app_uid = sourceUid;
                }
            }

            await entity.set('uid', await old_entity.get('uid'));
            extra.old_entity = old_entity;
        },

        async apply_joined_requested_name_ ({ canonicalUid, requestedName }) {
            if ( typeof canonicalUid !== 'string' || !canonicalUid ) return null;
            if ( typeof requestedName !== 'string' || !requestedName.trim() ) return null;
            const normalizedName = requestedName.trim();

            const currentRows = await this.db.read(
                'SELECT name FROM apps WHERE uid = ? LIMIT 1',
                [canonicalUid],
            );
            const currentName = currentRows?.[0]?.name;
            if ( typeof currentName !== 'string' ) return null;
            if ( currentName === normalizedName ) return null;

            const conflictRows = await this.db.read(
                'SELECT uid FROM apps WHERE name = ? AND uid != ? LIMIT 1',
                [normalizedName, canonicalUid],
            );
            if ( conflictRows.length > 0 ) {
                throw APIError.create('app_name_already_in_use', null, {
                    name: normalizedName,
                });
            }

            await this.db.write(
                'UPDATE apps SET name = ? WHERE uid = ? LIMIT 1',
                [normalizedName, canonicalUid],
            );

            return {
                oldName: currentName,
                newName: normalizedName,
            };
        },

        async is_origin_bootstrap_app_entity_ (entity) {
            if ( ! entity ) return false;
            const uid = await entity.get('uid');
            if ( typeof uid !== 'string' || !uid ) return false;
            if ( await entity.get('name') !== uid ) return false;
            if ( await entity.get('title') !== uid ) return false;
            const description = await entity.get('description');
            if ( typeof description !== 'string' ) return false;
            return description.startsWith('App created from origin ');
        },

        async ensureIndexUrlUnique (entity, extra) {
            const new_index_url = await entity.get('index_url');
            if ( ! new_index_url ) return;
            if ( ! this.is_puter_hosted_index_url_(new_index_url) ) return;

            if ( extra.old_entity ) {
                const old_index_url = await extra.old_entity.get('index_url');
                if ( old_index_url === new_index_url ) {
                    return;
                }
            }

            const currentMysqlId = await this.resolve_entity_mysql_id_(extra.old_entity);
            const conflictRow = await this.find_index_url_conflict_({
                indexUrl: new_index_url,
                excludeMysqlId: currentMysqlId,
            });
            if ( conflictRow ) {
                throw APIError.create('app_index_url_already_in_use', null, {
                    index_url: new_index_url,
                    app_uid: conflictRow.uid,
                });
            }
        },
    };
}

module.exports = AppES;
