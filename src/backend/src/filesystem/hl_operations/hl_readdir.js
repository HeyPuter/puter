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
const APIError = require("../../api/APIError");
const { Context } = require("../../util/context");
const { stream_to_buffer } = require("../../util/streamutil");
const { ECMAP } = require("../ECMAP");
const { TYPE_DIRECTORY, TYPE_SYMLINK } = require("../FSNodeContext");
const { LLListUsers } = require("../ll_operations/ll_listusers");
const { LLReadDir } = require("../ll_operations/ll_readdir");
const { LLReadShares } = require("../ll_operations/ll_readshares");
const { HLFilesystemOperation } = require("./definitions");

class HLReadDir extends HLFilesystemOperation {
    static CONCERN = 'filesystem';
    async _run() {
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

        this.log.noticeme('READDIR',
            {
            userdir: await subject.isUserDirectory(),
            namediff: await subject.get('name') !== user.username
            }
        );
        if ( subject.isRoot ) {
            const ll_listusers = new LLListUsers();
            children = await ll_listusers.run(this.values);
        } else if (
            await subject.getUserPart() !== user.username &&
            await subject.isUserDirectory()
        ) {
            this.log.noticeme('THIS HAPPEN');
            const ll_readshares = new LLReadShares();
            children = await ll_readshares.run(this.values);
        } else {
            const ll_readdir = new LLReadDir();
            children = await ll_readdir.run(this.values);
        }

        return Promise.all(children.map(async child => {
            // When thumbnails are requested, fetching before the call to
            // .getSafeEntry prevents .fetchEntry (possibly called by
            // .fetchSuggestedApps or .fetchSubdomains)
            if ( ! no_thumbs ) {
                await child.fetchEntry({ thumbnail: true });
            }

            if ( ! no_assocs ) {
                await Promise.all([
                    child.fetchSuggestedApps(user),
                    child.fetchSubdomains(user),
                ]);
            }
            const entry = await child.getSafeEntry();
            if ( ! no_thumbs && entry.associated_app ) {
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
}

module.exports = {
    HLReadDir,
};
