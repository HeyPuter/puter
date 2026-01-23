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
const { Context } = require('../../util/context');
const { stream_to_buffer } = require('../../util/streamutil');
const { get_apps } = require('../../helpers');
const { ECMAP } = require('../ECMAP');
const { TYPE_DIRECTORY, TYPE_SYMLINK } = require('../FSNodeContext');
const { LLListUsers } = require('../ll_operations/ll_listusers');
const { LLReadDir } = require('../ll_operations/ll_readdir');
const { LLReadShares } = require('../ll_operations/ll_readshares');
const { HLFilesystemOperation } = require('./definitions');
const { DB_READ } = require('../../services/database/consts');
const config = require('../../config');
const mime = require('mime-types');
const path = require('path');
const { kv } = require('../../util/kvSingleton');

const CODE_EXTENSIONS = [
    '.asm',
    '.asp',
    '.aspx',
    '.bash',
    '.c',
    '.cpp',
    '.css',
    '.csv',
    '.dhtml',
    '.f',
    '.go',
    '.h',
    '.htm',
    '.html',
    '.html5',
    '.java',
    '.jl',
    '.js',
    '.jsa',
    '.json',
    '.jsonld',
    '.jsf',
    '.jsp',
    '.kt',
    '.log',
    '.lock',
    '.lua',
    '.md',
    '.perl',
    '.phar',
    '.php',
    '.pl',
    '.py',
    '.r',
    '.rb',
    '.rdata',
    '.rda',
    '.rdf',
    '.rds',
    '.rs',
    '.rlib',
    '.rpy',
    '.scala',
    '.sc',
    '.scm',
    '.sh',
    '.sol',
    '.sql',
    '.ss',
    '.svg',
    '.swift',
    '.toml',
    '.ts',
    '.wasm',
    '.xhtml',
    '.xml',
    '.yaml',
];

const buildSuggestedAppSpecifiers = (fsentry) => {
    const nameSpecifiers = [];

    let contentType = mime.contentType(fsentry.name);
    if ( ! contentType ) contentType = '';

    const fileName = (() => {
        if ( ! fsentry.name ) return 'missing-fsentry-name';
        let result = fsentry.name.toLowerCase();
        if ( fsentry.is_dir ) result += '.directory';
        return result;
    })();

    const fileExtension = path.extname(fileName).toLowerCase();
    const anyOf = (list, name) => list.some(value => name.endsWith(value));

    if ( anyOf(CODE_EXTENSIONS, fileName) || !fileName.includes('.') ) {
        nameSpecifiers.push({ name: 'code' });
        nameSpecifiers.push({ name: 'editor' });
    }

    if ( fileName.endsWith('.txt') || !fileName.includes('.') ) {
        nameSpecifiers.push({ name: 'editor' });
        nameSpecifiers.push({ name: 'code' });
    }
    if ( fileName.endsWith('.md') ) {
        nameSpecifiers.push({ name: 'markus' });
    }
    if (
        fileName.endsWith('.jpg') ||
        fileName.endsWith('.png') ||
        fileName.endsWith('.webp') ||
        fileName.endsWith('.svg') ||
        fileName.endsWith('.bmp') ||
        fileName.endsWith('.jpeg')
    ) {
        nameSpecifiers.push({ name: 'viewer' });
    }
    if (
        fileName.endsWith('.bmp') ||
        contentType.startsWith('image/')
    ) {
        nameSpecifiers.push({ name: 'draw' });
    }
    if ( fileName.endsWith('.pdf') ) {
        nameSpecifiers.push({ name: 'pdf' });
    }
    if (
        fileName.endsWith('.mp4') ||
        fileName.endsWith('.webm') ||
        fileName.endsWith('.mpg') ||
        fileName.endsWith('.mpv') ||
        fileName.endsWith('.mp3') ||
        fileName.endsWith('.m4a') ||
        fileName.endsWith('.ogg')
    ) {
        nameSpecifiers.push({ name: 'player' });
    }

    const associatedAppIds = kv.get(`assocs:${fileExtension.slice(1)}:apps`) ?? [];
    const idSpecifiers = associatedAppIds.map(appId => ({ id: appId }));

    return { nameSpecifiers, idSpecifiers };
};

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
        const { subject: subject_let, user, no_thumbs, no_assocs, actor } = this.values;
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

        this.log.debug('READDIR',
                        {
                            userdir: await subject.isUserDirectory(),
                            namediff: await subject.get('name') !== user.username,
                        });
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
            await Promise.all([
                this.#batchFetchSuggestedApps(children, user),
                this.#batchFetchSubdomains(children, user),
            ]);
        }

        return Promise.all(children.map(async child => {
            const entry = await child.getSafeEntry();
            if ( !no_thumbs && entry.associated_app ) {
                const svc_appIcon = this.context.get('services').get('app-icon');
                const icon_result = await svc_appIcon.get_icon_stream({
                    app_icon: entry.associated_app.icon,
                    app_uid: entry.associated_app.uid ?? entry.associated_app.uuid,
                    size: 64,
                });

                if ( icon_result.data_url ) {
                    entry.associated_app.icon = icon_result.data_url;
                } else {
                    try {
                        const buffer = await stream_to_buffer(icon_result.stream);
                        const resp_data_url = `data:${icon_result.mime};base64,${buffer.toString('base64')}`;
                        entry.associated_app.icon = resp_data_url;
                    } catch (e) {
                        const svc_error = this.context.get('services').get('error-service');
                        svc_error.report('hl_readdir:icon-stream', {
                            source: e,
                        });
                    }
                }
            }
            return entry;
        }));
    }

    async #batchFetchSubdomains (children, user) {
        const dirChildren = [];
        const childById = new Map();

        for ( const child of children ) {
            const entry = child.entry;
            if ( ! entry?.is_dir ) continue;
            entry.subdomains = [];
            if ( entry.id == null ) continue;
            dirChildren.push(entry.id);
            childById.set(entry.id, child);
        }

        if ( dirChildren.length === 0 ) return;

        const placeholders = dirChildren.map(() => '?').join(',');
        const db = this.context.get('services').get('database').get(DB_READ, 'filesystem');
        const rows = await db.read(`SELECT root_dir_id, subdomain, uuid
             FROM subdomains
             WHERE root_dir_id IN (${placeholders}) AND user_id = ?`,
        [...dirChildren, user.id]);

        for ( const row of rows ) {
            const child = childById.get(row.root_dir_id);
            if ( ! child ) continue;
            child.entry.subdomains.push({
                subdomain: row.subdomain,
                address: `${config.protocol }://${ row.subdomain }.puter.site`,
                uuid: row.uuid,
            });
            child.entry.has_website = true;
        }
    }

    async #batchFetchSuggestedApps (children, user) {
        const specifiers = [];
        const batches = [];

        for ( const child of children ) {
            const entry = child.entry;
            if ( !entry || entry.suggested_apps ) continue;

            const { nameSpecifiers, idSpecifiers } = buildSuggestedAppSpecifiers(entry);
            const childSpecifiers = [...nameSpecifiers, ...idSpecifiers];

            if ( childSpecifiers.length === 0 ) {
                entry.suggested_apps = [];
                continue;
            }

            const offset = specifiers.length;
            const specCount = childSpecifiers.length;
            specifiers.push(...childSpecifiers);
            batches.push({
                child,
                offset,
                specCount,
                nameCount: nameSpecifiers.length,
                needsCodeApp: false,
                suggestedApps: [],
            });
        }

        if ( specifiers.length === 0 ) return;

        const resolved = await get_apps(specifiers);
        let anyNeedsCodeApp = false;

        for ( const batch of batches ) {
            const slice = resolved.slice(batch.offset, batch.offset + batch.specCount);
            const nameApps = slice.slice(0, batch.nameCount);
            const thirdPartyApps = slice.slice(batch.nameCount);

            const suggestedApps = [];
            suggestedApps.push(...nameApps);
            for ( const thirdPartyApp of thirdPartyApps ) {
                if ( ! thirdPartyApp ) continue;
                if (
                    thirdPartyApp.approved_for_opening_items ||
                    (user && user.id === thirdPartyApp.owner_user_id)
                ) {
                    suggestedApps.push(thirdPartyApp);
                }
            }

            batch.needsCodeApp = suggestedApps.some(app => app && app.name === 'editor');
            if ( batch.needsCodeApp ) anyNeedsCodeApp = true;
            batch.suggestedApps = suggestedApps;
        }

        let codeApp;
        if ( anyNeedsCodeApp ) {
            [codeApp] = await get_apps([{ name: 'codeapp' }]);
        }

        for ( const batch of batches ) {
            let suggestedApps = batch.suggestedApps;
            if ( batch.needsCodeApp && codeApp ) {
                suggestedApps = [...suggestedApps, codeApp];
            }

            batch.child.entry.suggested_apps = suggestedApps.filter((suggestedApp, pos, self) => {
                if ( ! suggestedApp ) return false;
                return self.indexOf(suggestedApp) === pos;
            });
        }
    }
}

module.exports = {
    HLReadDir,
};
