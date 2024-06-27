// TODO: accessing these imports directly from a mod is not really
//       the way mods are intended to work; this is temporary until
//       we have these things registered in "useapi".
const {
    get_user,
    generate_system_fsentries,
    invalidate_cached_user,
} = require('../../../packages/backend/src/helpers');
// const { HLWrite } = require('../../../packages/backend/src/filesystem/hl_operations/hl_write');
const { Actor, UserActorType }
    = require('../../../packages/backend/src/services/auth/Actor');
const { DB_WRITE } = require('../../../packages/backend/src/services/database/consts');

    
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
                    this.runit();
                }
            }
        ]);
    }
    
    async runit () {
        await this.teardown_();
        await this.setup_();
        
        for ( const scenario of this.scenarios ) {
            this.run_scenario_(scenario);
        }
        
        await this.teardown_();
    }
    
    async setup_ () {
        await this.create_test_user_('testuser_eric');
        await this.create_test_user_('testuser_stan');
        await this.create_test_user_('testuser_kyle');
        await this.create_test_user_('testuser_kenny');
    }
    async run_scenario_ (scenario) {
        // Run sequence
        for ( const step of scenario.sequence ) {
            const method = this[`__scenario:${step.call}`];
            const user = await get_user({ username: step.as })
            const actor = Actor.create(UserActorType, { user });
            const generated = { user, actor };
            await method.call(this, generated, scenario.with);
        }
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
        await generate_system_fsentries(user);
        invalidate_cached_user(user);
        return user;
    }
    
    async delete_test_user_ (username) {
        await this.db.write(
            `
                DELETE FROM user WHERE username=? LIMIT 1
            `,
            [username],
        );
    }
    
    // API for scenarios
    async ['__scenario:create-example-file'] (
        { user },
        { name, contents },
    ) {
        console.log('test -> create-example-file',
            user, name, contents);
        // const hl_write = new HLWrite();
        // await hl_write.run({
        //     destination_or_parent: '/'+user.username+'/Desktop',
        //     specified_name: name,

        // });
    }
    async ['__scenario:assert-no-access'] (
        { user },
        { path },
    ) {
        console.log('test -> assert-no-access', user, path);
    }
}

module.exports = {
    ShareTestService,
};
