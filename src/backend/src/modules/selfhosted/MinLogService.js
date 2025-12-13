const BaseService = require('../../services/BaseService');

class MinLogService extends BaseService {
    static DESCRIPTION = `
        MinLogService hides any log messages which specify an area of concern.
        A developer can enable particular areas of concern through the console.
    `;

    _construct () {
        this.on = false;
        this.visible = new Set();
    }

    _init () {
        // On operating systems where low-level config (high customization) is
        // expected, we can turn off minlog by default.
        if ( this.global_config.os.refined ) this.on = false;

        // Register log middleware to hide logs
        const svc_log = this.services.get('log-service');
        svc_log.register_log_middleware(async log_details => {
            if ( ! this.on ) return;

            const { fields } = log_details;
            if ( fields.hasOwnProperty('concern') ) {
                if ( ! this.visible.has(fields.concern) ) {
                    return { skip: true };
                }
            }

            return;
        });

        this._register_commands(this.services.get('commands'));
    }

    _register_commands (commands) {
        commands.registerCommands('minlog', [
            {
                id: 'on',
                handler: async (args, log) => {
                    this.on = true;
                },
            },
            {
                id: 'off',
                handler: async (args, log) => {
                    this.on = false;
                },
            },
            {
                id: 'show',
                handler: async (args, log) => {
                    const [ name ] = args;

                    this.visible.add(name);
                },
            },
            {
                id: 'hide',
                handler: async (args, log) => {
                    const [ name ] = args;

                    this.visible.delete(name);
                },
            },
        ]);
    }
}

module.exports = MinLogService;
