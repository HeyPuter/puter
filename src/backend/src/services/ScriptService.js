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
                },
                completer: (args) => {
                    // The script name is the first argument, so return no results if we're on the second or later.
                    if (args.length > 1)
                        return;
                    const scriptName = args[args.length - 1];

                    return this.scripts
                        .filter(script => scriptName.startsWith(scriptName))
                        .map(script => script.name);
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
