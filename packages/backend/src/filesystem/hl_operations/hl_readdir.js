/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { chkperm } = require("../../helpers");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLListUsers } = require("../ll_operations/ll_listusers");
const { LLReadDir } = require("../ll_operations/ll_readdir");
const { LLReadShares } = require("../ll_operations/ll_readshares");
const { HLFilesystemOperation } = require("./definitions");

class HLReadDir extends HLFilesystemOperation {
    async _run () {
        const { subject, user, no_thumbs, no_assocs, actor } = this.values;

        if ( ! await subject.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        if ( await subject.get('type') !== TYPE_DIRECTORY ) {
            const { context } = this;
            const svc_acl = context.get('services').get('acl');
            if ( ! await svc_acl.check(actor, subject, 'see') ) {
                throw await svc_acl.get_safe_acl_error(actor, subject, 'see');
            }
            return [subject];
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
            await subject.getUserPart() !== user.username
        ) {
            this.log.noticeme('THIS HAPPEN');
            const ll_readshares = new LLReadShares();
            children = await ll_readshares.run(this.values);
        } else {
            const ll_readdir = new LLReadDir();
            children = await ll_readdir.run(this.values);
        }

        return Promise.all(children.map(async child => {
            // await child.fetchAll(null, user);
            if ( ! no_assocs ) {
                await child.fetchSuggestedApps(user);
                await child.fetchSubdomains(user);
            }
            const fs = require('fs');
            // fs.appendFileSync('/tmp/children.log',
            //     JSON.stringify({
            //         no_thumbs,
            //         no_assocs,
            //         entry: child.entry,
            //     }) + '\n');
            return await child.getSafeEntry({ thumbnail: ! no_thumbs });
        }));
    }
}

module.exports = {
    HLReadDir,
};
