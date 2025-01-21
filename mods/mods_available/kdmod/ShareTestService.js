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
// TODO: accessing these imports directly from a mod is not really
//       the way mods are intended to work; this is temporary until
//       we have these things registered in "useapi".
const {
    get_user,
    invalidate_cached_user,
    deleteUser,
} = require('../../../src/backend/src/helpers.js');
const { HLWrite } = require('../../../src/backend/src/filesystem/hl_operations/hl_write.js');
const { LLRead } = require('../../../src/backend/src/filesystem/ll_operations/ll_read.js');
const { Actor, UserActorType }
    = require('../../../src/backend/src/services/auth/Actor.js');
const { DB_WRITE } = require('../../../src/backend/src/services/database/consts.js');
const {
    RootNodeSelector,
    NodeChildSelector,
    NodePathSelector,
} = require('../../../src/backend/src/filesystem/node/selectors.js');
const { Context } = require('../../../src/backend/src/util/context.js');

    
class ShareTestService extends use.Service {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }

    async _init () {
        const svc_commands = this.services.get('commands');
        this._register_commands(svc_commands);
        
        this.scenarios = require('./data/sharetest_scenarios');

        const svc_db = this.services.get('database');
        this.db = svc_db.get(svc_db.DB_WRITE, 'share-test');
    }
    
    _register_commands (commands) {
        commands.registerCommands('share-test', [
            {
                id: 'start',
                description: '',
                handler: async (_, log) => {
                    const results = await this.runit();
                    
                    for ( const result of results ) {
                        log.log(`=== ${result.title} ===`);
                        if ( ! result.report ) {
                            log.log(`\x1B[32;1mSUCCESS\x1B[0m`);
                            continue;
                        }
                        log.log(
                            `\x1B[31;1mSTOPPED\x1B[0m at ` +
                            `${result.report.step}: ` +
                            result.report.report.message,
                        );
                    }
                }
            }
        ]);
    }
    
    async runit () {
        await this.teardown_();
        await this.setup_();
        
        const results = [];
        
        for ( const scenario of this.scenarios ) {
            if ( ! scenario.title ) {
                scenario.title = scenario.sequence.map(
                    step => step.title).join('; ')
            }
            results.push({
                title: scenario.title,
                report: await this.run_scenario_(scenario)
            });
        }
        
        await this.teardown_();
        return results;
    }
    
    async setup_ () {
        await this.create_test_user_('testuser_eric');
        await this.create_test_user_('testuser_stan');
        await this.create_test_user_('testuser_kyle');
        await this.create_test_user_('testuser_kenny');
    }
    async run_scenario_ (scenario) {
        let error;
        // Run sequence
        for ( const step of scenario.sequence ) {
            const method = this[`__scenario:${step.call}`];
            const user = await get_user({ username: step.as })
            const actor = await Actor.create(UserActorType, { user });
            const generated = { user, actor };
            const report = await Context.get().sub({ user, actor })
                .arun(async () => {
                    return await method.call(this, generated, step.with);
                });
            if ( report ) {
                error = { step: step.title, report };
                break;
            }
        }
        return error;
    }
    async teardown_ () {
        await this.delete_test_user_('testuser_eric');
        await this.delete_test_user_('testuser_stan');
        await this.delete_test_user_('testuser_kyle');
        await this.delete_test_user_('testuser_kenny');
    }

    async create_test_user_ (username) {
        await this.db.write(
            `
                INSERT INTO user (uuid, username, email, free_storage, password)
                VALUES (?, ?, ?, ?, ?)
            `,
            [
                this.modules.uuidv4(),
                username,
                username + '@example.com',
                1024 * 1024 * 500, // 500 MiB
                this.modules.uuidv4(),
            ],
        );
        const user = await get_user({ username });
        const svc_user = this.services.get('user');
        await svc_user.generate_default_fsentries({ user });
        invalidate_cached_user(user);
        return user;
    }
    
    async delete_test_user_ (username) {
        const user = await get_user({ username });
        if ( ! user ) return;
        await deleteUser(user.id);
    }
    
    // API for scenarios
    async ['__scenario:create-example-file'] (
        { actor, user },
        { name, contents },
    ) {
        const svc_fs = this.services.get('filesystem');
        const parent = await svc_fs.node(new NodePathSelector(
            `/${user.username}/Desktop`
        ));
        console.log('test -> create-example-file',
            user, name, contents);
        const buffer = Buffer.from(contents);
        const file = {
            size: buffer.length,
            name: name,
            type: 'application/octet-stream',
            buffer,
        };
        const hl_write = new HLWrite();
        await hl_write.run({
            actor,
            user,
            destination_or_parent: parent,
            specified_name: name,
            file,
        });
    }
    async ['__scenario:assert-no-access'] (
        { actor, user },
        { path },
    ) {
        const svc_fs = this.services.get('filesystem');
        const node = await svc_fs.node(new NodePathSelector(path));
        const ll_read = new LLRead();
        let expected_e; try {
            const stream = await ll_read.run({
                fsNode: node,
                actor,
            })
        } catch (e) {
            expected_e = e;
        }
        if ( ! expected_e ) {
            return { message: 'expected error, got none' };
        }
    }
    async ['__scenario:grant'] (
        { actor, user },
        { to, permission },
    ) {
        const svc_permission = this.services.get('permission');
        await svc_permission.grant_user_user_permission(
            actor, to, permission, {}, {},
        );
    }
    async ['__scenario:assert-access'] (
        { actor, user },
        { path, level }
    ) {
        const svc_fs = this.services.get('filesystem');
        const svc_acl = this.services.get('acl');
        const node = await svc_fs.node(new NodePathSelector(path));
        const has_read = await svc_acl.check(actor, node, 'read');
        const has_write = await svc_acl.check(actor, node, 'write');

        if ( level !== 'write' && level !== 'read' ) {
            return {
                message: 'unexpected value for "level" parameter'
            };
        }

        if ( level === 'read' && has_write ) {
            return {
                message: 'expected read-only but actor can write'
            };
        }
        if ( level === 'read' && !has_read ) {
            return {
                message: 'expected read access but no read access'
            };
        }
        if ( level === 'write' && (!has_write || !has_read) ) {
            return {
                message: 'expected write access but no write access'
            };
        }
    }
}

module.exports = {
    ShareTestService,
};
