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

class HLStat extends HLFilesystemOperation {
    static MODULES = {
        ['mime-types']: require('mime-types'),
    }

    async _run () {
        const {
            subject, user,
            return_subdomains,
            return_permissions,
            return_versions,
            return_size,
        } = this.values;

        await subject.fetchEntry();

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
        if (return_permissions) await subject.fetchShares();
        if (return_versions) await subject.fetchVersions();

        await subject.fetchIsEmpty();

        return await subject.getSafeEntry();
    }
}

module.exports = {
    HLStat
};
