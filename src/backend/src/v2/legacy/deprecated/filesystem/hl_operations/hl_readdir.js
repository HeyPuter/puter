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
const APIError = require('../../../api/APIError');
const { Context } = require('../../../util/context');
const { get_apps, suggestedAppsForFsEntries } = require('../../../helpers');
const { ECMAP } = require('../ECMAP');
const { TYPE_DIRECTORY, TYPE_SYMLINK } = require('../FSNodeContext');
const { LLListUsers } = require('../ll_operations/ll_listusers');
const { LLReadDir } = require('../ll_operations/ll_readdir');
const { LLReadShares } = require('../ll_operations/ll_readshares');
const { HLFilesystemOperation } = require('./definitions');
const { DB_READ } = require('../../../services/database/consts');
const config = require('../../../config');

class HLReadDir extends HLFilesystemOperation {
    static CONCERN = 'filesystem';
    async _run () {
        return ECMAP.arun(async () => {
            const ecmap = Context.get(ECMAP.SYMBOL);
            ecmap.store_fsNodeContext(this.values.subject);
            return await this.__run();
        });
    }
    async __run () {
        const { subject: subject_let, user, no_thumbs, no_assocs, no_subdomains, actor } = this.values;
        let subject = subject_let;

        if ( ! await subject.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        if ( await subject.get('type') === TYPE_SYMLINK ) {
            const { context } = this;
            const svc_acl = context.get('services').get('acl');
            if ( ! await svc_acl.check(actor, subject, 'read') ) {
                throw await svc_acl.get_safe_acl_error(actor, subject, 'read');
            }
            const target = await subject.getTarget();
            subject = target;
        }

        if ( await subject.get('type') !== TYPE_DIRECTORY ) {
            const { context } = this;
            const svc_acl = context.get('services').get('acl');
            if ( ! await svc_acl.check(actor, subject, 'see') ) {
                throw await svc_acl.get_safe_acl_error(actor, subject, 'see');
            }
            throw APIError.create('readdir_of_non_directory');
        }

        let children;

        this.log.debug(
            'READDIR',
            {
                userdir: await subject.isUserDirectory(),
                namediff: await subject.get('name') !== user.username,
            },
        );
        if ( subject.isRoot ) {
            const ll_listusers = new LLListUsers();
            children = await ll_listusers.run(this.values);
        } else if (
            await subject.getUserPart() !== user.username &&
            await subject.isUserDirectory()
        ) {
            const ll_readshares = new LLReadShares();
            children = await ll_readshares.run(this.values);
        } else {
            const ll_readdir = new LLReadDir();
            children = await ll_readdir.run(this.values);
        }

        const associated_app_specifiers = [];
        const children_with_assoc = [];
        await Promise.all(children.map(async child => {
            if ( ! no_thumbs ) {
                await child.fetchEntry({ thumbnail: true });
            } else {
                await child.fetchEntry();
            }

            const assoc_id = child.entry?.associated_app_id;
            if ( assoc_id ) {
                associated_app_specifiers.push({ id: assoc_id });
                children_with_assoc.push({ child, assoc_id });
            }
        }));

        if ( associated_app_specifiers.length ) {
            const assoc_apps = await get_apps(associated_app_specifiers);
            const app_by_id = new Map();
            for ( let i = 0; i < associated_app_specifiers.length; i++ ) {
                const app = assoc_apps[i];
                if ( app ) {
                    app_by_id.set(associated_app_specifiers[i].id, app);
                }
            }
            for ( const { child, assoc_id } of children_with_assoc ) {
                const app = app_by_id.get(assoc_id);
                if ( app ) {
                    child.entry.associated_app = app;
                }
            }
        }

        if ( ! no_assocs ) {
            await this.#batchFetchSuggestedApps(children, user);
        }

        if ( ! no_subdomains ) {
            const usedPrefetchedSubdomains = await this.#applySubdomains(children);
            if ( ! usedPrefetchedSubdomains ) {
                await this.#batchFetchSubdomains(children, user);
            }
        }

        return Promise.all(children.map(async child => {
            const entry = await child.getSafeEntry();
            if ( !no_thumbs && entry.associated_app ) {
                const svc_appIcon = this.context.get('services').get('app-icon');
                const iconPath = svc_appIcon.getAppIconPath({
                    appUid: entry.associated_app.uid ?? entry.associated_app.uuid,
                    size: 64,
                });
                if ( iconPath ) {
                    entry.associated_app.icon = iconPath;
                }
            }
            return entry;
        }));
    }

    async #applySubdomains (children) {
        let usedPrefetchedSubdomains = false;

        for ( const child of children ) {
            const entry = child.entry;
            if ( ! entry ) continue;
            this.#initializeSubdomainFields(entry);

            const prefetchedSubdomains = child.subdomains ?? entry.subdomains;
            if ( prefetchedSubdomains === undefined ) return false;

            usedPrefetchedSubdomains = true;
            if ( ! Array.isArray(prefetchedSubdomains) ) continue;

            for ( const subdomain of prefetchedSubdomains ) {
                this.#appendSubdomainToEntry({
                    entry,
                    subdomain: subdomain?.subdomain,
                    uuid: subdomain?.uuid,
                });
            }
        }

        return usedPrefetchedSubdomains;
    }

    async #batchFetchSubdomains (children, user) {
        const childIds = [];
        const childById = new Map();

        for ( const child of children ) {
            const entry = child.entry;
            if ( ! entry ) continue;
            this.#initializeSubdomainFields(entry);
            if ( entry.id == null ) continue;
            childIds.push(entry.id);
            childById.set(entry.id, child);
        }

        if ( childIds.length === 0 ) return;

        const placeholders = childIds.map(() => '?').join(',');
        const db = this.context.get('services').get('database').get(DB_READ, 'filesystem');
        const rows = await db.read(
            `SELECT root_dir_id, subdomain, uuid
             FROM subdomains
             WHERE root_dir_id IN (${placeholders}) AND user_id = ?`,
            [...childIds, user.id],
        );

        for ( const row of rows ) {
            const child = childById.get(row.root_dir_id);
            if ( ! child ) continue;
            this.#appendSubdomainToEntry({
                entry: child.entry,
                subdomain: row.subdomain,
                uuid: row.uuid,
            });
        }
    }

    #initializeSubdomainFields (entry) {
        entry.subdomains = [];
        entry.workers = [];
        entry.has_website = false;
    }

    #appendSubdomainToEntry ({ entry, subdomain, uuid }) {
        if ( ! subdomain ) return;

        if ( entry.is_dir ) {
            entry.subdomains.push({
                subdomain,
                address: `${config.protocol}://${subdomain}.puter.site`,
                uuid,
            });
        } else {
            const workerName = subdomain.split('.').pop();
            entry.workers.push({
                subdomain: workerName,
                address: `https://${workerName}.puter.work`,
                uuid,
            });
        }

        entry.has_website = true;
    }

    async #batchFetchSuggestedApps (children, user) {
        const entries = [];
        const targets = [];

        for ( const child of children ) {
            const entry = child.entry;
            if ( !entry || entry.suggested_apps ) continue;
            entries.push(entry);
            targets.push(entry);
        }

        if ( entries.length === 0 ) return;

        const suggestedLists = await suggestedAppsForFsEntries(entries, { user });
        for ( let index = 0; index < targets.length; index++ ) {
            targets[index].suggested_apps = suggestedLists[index] ?? [];
        }
    }
}

module.exports = {
    HLReadDir,
};
