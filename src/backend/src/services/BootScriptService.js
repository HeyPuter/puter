const { Context } = require("../util/context");
const BaseService = require("./BaseService");

class BootScriptService extends BaseService {
    static MODULES = {
        fs: require('fs'),
    }
    async ['__on_boot.ready'] () {
        const args = Context.get('args');
        if ( ! args['boot-script'] ) return;
        const script_name = args['boot-script'];

        const require = this.require;
        const fs = require('fs');
        const boot_json_raw = fs.readFileSync(script_name, 'utf8');
        const boot_json = JSON.parse(boot_json_raw);
        await this.run_script(boot_json);
    }

    async run_script (boot_json) {
        const scope = {
            runner: 'boot-script',
            ['end-puter-process']: ({ args }) => {
                const svc_shutdown = this.services.get('shutdown');
                svc_shutdown.shutdown(args[0]);
            }
        };

        for ( let i=0 ; i < boot_json.length ; i++ ) {
            const statement = boot_json[i];
            const [cmd, ...args] = statement;
            if ( ! scope[cmd] ) {
                throw new Error(`Unknown command: ${cmd}`);
            }
            await scope[cmd]({ scope, args });
        }
    }
}

module.exports = {
    BootScriptService
};
