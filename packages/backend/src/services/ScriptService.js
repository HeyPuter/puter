const BaseService = require("./BaseService");

class BackendScript {
    constructor (name, fn) {
        this.name = name;
        this.fn = fn;
    }

    async run (ctx, args) {
        return await this.fn(ctx, args);
    }

}

class ScriptService extends BaseService {
    _construct () {
        this.scripts = [];
    }

    async _init () {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('script', [
            {
                id: 'run',
                description: 'run a script',
                handler: async (args, ctx) => {
                    const script_name = args.shift();
                    const script = this.scripts.find(s => s.name === script_name);
                    if ( ! script ) {
                        ctx.error(`script not found: ${script_name}`);
                        return;
                    }
                    await script.run(ctx, args);
                }
            }
        ]);
    }

    register (name, fn) {
        this.scripts.push(new BackendScript(name, fn));
    }
}

module.exports = {
    ScriptService,
    BackendScript,
};
