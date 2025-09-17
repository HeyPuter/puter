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
const { Context } = require("../../util/context");
const { HLFilesystemOperation } = require("./definitions");
const APIError = require('../../api/APIError');
const { ECMAP } = require("../ECMAP");
const { NodeUIDSelector } = require("../node/selectors");

class HLStat extends HLFilesystemOperation {
    static MODULES = {
        ['mime-types']: require('mime-types'),
    }

    async _run () {
        return await ECMAP.arun(async () => {
            const ecmap = Context.get(ECMAP.SYMBOL);
            ecmap.store_fsNodeContext(this.values.subject);
            return await this.__run();
        });
    }
    // async _run () {
    //     return await this.__run();
    // }
    async __run () {
        const {
            subject, user,
            return_subdomains,
            return_permissions, // Deprecated: kept for backwards compatiable with `return_shares`
            return_shares,
            return_versions,
            return_size,
        } = this.values;
        
        const maybe_uid_selector = subject.get_selector_of_type(NodeUIDSelector);
        
        // users created before 2025-07-30 might have fsentries with NULL paths.
        // we can remove this check once that is fixed.
        const user_unix_ts = Number((''+Date.parse(Context.get('actor')?.type?.user?.timestamp)).slice(0, -3));
        const paths_are_fine = user_unix_ts >= 1722385593;

        if ( maybe_uid_selector || paths_are_fine ) {
            // We are able to fetch the entry and is_empty simultaneously
            await Promise.all([
                subject.fetchEntry(),
                subject.fetchIsEmpty(),
            ]);
        } else {
            // We need the entry first in order for is_empty to work correctly
            await subject.fetchEntry();
            await subject.fetchIsEmpty();
        }

        // file not found
        if( ! subject.found ) throw APIError.create('subject_does_not_exist');

        await subject.fetchOwner();

        const context = Context.get();
        const svc_acl = context.get('services').get('acl');
        const actor = context.get('actor');
        if ( ! await svc_acl.check(actor, subject, 'read') ) {
            throw await svc_acl.get_safe_acl_error(actor, subject, 'read');
        }

        // TODO: why is this specific to stat?
        const mime = this.require('mime-types');
        const contentType = mime.contentType(subject.entry.name)
        subject.entry.type = contentType ? contentType : null;

        if (return_size) await subject.fetchSize(user);
        if (return_subdomains) await subject.fetchSubdomains(user)
        if (return_shares || return_permissions) {
            await subject.fetchShares();
        }
        if (return_versions) await subject.fetchVersions();

        return await subject.getSafeEntry();
    }
}

module.exports = {
    HLStat
};
