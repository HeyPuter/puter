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
const { redisClient } = require('../../clients/redis/redisSingleton');
const config = require('../../config');
const { app_name_exists } = require('../../helpers');
const { AppUnderUserActorType } = require('../../services/auth/Actor');
const { DB_WRITE } = require('../../services/database/consts');
const { Context } = require('../../util/context');
const { origin_from_url } = require('../../util/urlutil');
const { Eq, Like, Or, And } = require('../query/query');
const { BaseES } = require('./BaseES');

const uuidv4 = require('uuid').v4;

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
            const actor = Context.get('actor');
            const user = actor?.type?.user;

            const full_entity = extra.old_entity
                ? await (await extra.old_entity.clone()).apply(entity)
                : entity
                ;

            await this.ensure_puter_site_subdomain_is_owned_(full_entity, extra, user);

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
                await this.db.write('DELETE FROM app_filetype_association WHERE app_id = ?',
                                [insert_id]);
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
                await redisClient.del(...Array.from(affectedAssociationExtensions)
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
                if ( event.url ) {
                    this.db.write('UPDATE apps SET icon = ? WHERE id = ? LIMIT 1',
                                    [event.url, insert_id]);
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
                await this.db.write('UPDATE subdomains SET associated_app_id = ? WHERE id = ?',
                                [insert_id, subdomain_id]);
            }
            if ( extra.old_entity ) {
                const svc_event = this.context.get('services').get('event');
                await svc_event.emit('app.changed', {
                    app_uid: await full_entity.get('uid'),
                    action: 'updated',
                });
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
                if ( ! event.url ) return;

                await this.db.write('UPDATE apps SET icon = ? WHERE uid = ? LIMIT 1',
                                [event.url, app_uid]);
            }).catch(e => {
                const svc_error = this.context.get('services').get('error-service');
                svc_error.report('AppES:queue_icon_migration', { source: e });
            }).finally(() => {
                this.pending_icon_migrations_.delete(migration_key);
            });
        },

        /**
         * Transforms app data before reading by adding associations and handling permissions
         * @param {Object} entity - App entity to transform
         */
        async read_transform (entity) {
            // Add file associations
            const rows = await this.db.read('SELECT type FROM app_filetype_association WHERE app_id = ?',
                            [entity.private_meta.mysql_id]);
            entity.set('filetype_associations', rows.map(row => row.type));

            const svc_appInformation = this.context.get('services').get('app-information');
            const stats = await svc_appInformation.get_stats(await entity.get('uid'), { period: Context.get('es_params')?.stats_period, grouping: Context.get('es_params')?.stats_grouping, created_at: await entity.get('created_at') });
            entity.set('stats', stats);

            // Migrate b64 icons to the filesystem-backed icon flow without blocking reads.
            this.queueIconMigration(entity);

            entity.set('created_from_origin', await (async () => {
                const svc_auth = this.context.get('services').get('auth');
                try {
                    const origin = origin_from_url(await entity.get('index_url'));
                    const expected_uid = await svc_auth.app_uid_from_origin(origin);
                    return expected_uid === await entity.get('uid')
                        ? origin : null ;
                } catch (e) {
                    // This happens when the index_url is not a valid URL
                    return null;
                }
            })());

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
                let subdomain_res = await this.db.write(`INSERT ${this.db.case({
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
                ]);
                subdomain_id = subdomain_res.insertId;
            }

            return subdomain_id;
        },

        /**
         * Ensures that when an app uses a puter.site subdomain as its index_url,
         * the subdomain belongs to the user creating/updating the app.
         */
        async ensure_puter_site_subdomain_is_owned_ (entity, extra, user) {
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

            let hostname;
            try {
                hostname = (new URL(new_index_url)).hostname.toLowerCase();
            } catch {
                return;
            }

            const hosting_domain = config.static_hosting_domain?.toLowerCase();
            const hosting_domain_alt = config.static_hosting_domain_alt?.toLowerCase();
            if ( ! hosting_domain ) return;

            const suffix = `.${hosting_domain}`;
            const suffix2 = `.${hosting_domain_alt}`;
            if (
                !hostname.endsWith(suffix) &&
                !(hosting_domain_alt && hostname.endsWith(suffix2))
            ) {
                return;
            }

            const subdomain = hostname.slice(0, hostname.length - suffix.length);
            if ( ! subdomain ) return;

            const svc_puterSite = this.context.get('services').get('puter-site');
            const site = await svc_puterSite.get_subdomain(subdomain, { is_custom_domain: false });

            if ( !site || site.user_id !== user.id ) {
                throw APIError.create('subdomain_not_owned', null, { subdomain });
            }
        },
    };
}

module.exports = AppES;
