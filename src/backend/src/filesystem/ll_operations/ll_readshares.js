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
const { Context } = require("../../util/context");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLFilesystemOperation } = require("./definitions");
const { LLReadDir } = require("./ll_readdir");

class LLReadShares extends LLFilesystemOperation {
    static description = `
        Obtain the highest-level entries under this directory
        for which the current actor has at least "see" permission.
        
        This is a breadth-first search. When any node is
        found with "see" permission is found, children of that node
        will not be traversed.
    `;
    
    async _run () {
        const results = [];
        await this.recursive_part(results, this.values);
        
        return results;
    }
    
    async recursive_part (results, { subject, user, actor }) {
        actor = actor || Context.get('actor');
        const ll_readdir = new LLReadDir();
        const children = await ll_readdir.run({
            subject, user,
            no_thumbs: true,
            no_assocs: true,
            no_acl: true,
        });
        
        const svc = Context.get('services');
        const svc_acl = svc.get('acl');
        
        const promises = [];
        
        for ( const child of children ) {
            // If we have at least see permission: terminal node
            const acl_result = await svc_acl.check(actor, child, 'see');
            console.log(
                '\x1B[31;1mWHAT DIS?\x1B[0m',
                actor,
                child.entry?.path,
                child.selectors_[0].describe(),
                acl_result,
            )
            if ( acl_result ) {
                results.push(child);
                continue;
            }
            
            if ( await child.get('type') !== TYPE_DIRECTORY ) {
                continue;
            }
            
            const p = this.recursive_part(results, {
                subject: child, user });
            promises.push(p);
        }
        
        await Promise.all(promises);
    }
}

module.exports = {
    LLReadShares,
};
