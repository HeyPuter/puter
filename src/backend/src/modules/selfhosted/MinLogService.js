const BaseService = require("../../services/BaseService");

class MinLogService extends BaseService {
    static DESCRIPTION = `
        MinLogService hides any log messages which specify an area of concern.
        A developer can enable particular areas of concern through the console.
    `
    
    _construct () {
        this.on = true;
        this.visible = new Set();
        
        this.widget_ = null;
    }
    
    _init () {
        // Show console widget so developer knows logs are hidden
        this.add_dev_console_widget_();

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
    
    add_dev_console_widget_() {
        const svc_devConsole = this.services.get('dev-console', { optional: true });
        if ( ! svc_devConsole ) return;
        
        this.widget_ = () => {
            const lines = [
                `\x1B[31;1mSome logs hidden! Type minlog:off to see all logs.\x1B[0m`
            ];
            return lines;
        }
        svc_devConsole.add_widget(this.widget_);
    }

    rm_dev_console_widget_() {
        const svc_devConsole = this.services.get('dev-console', { optional: true });
        if ( ! svc_devConsole ) return;
        
        const lines = this.widget_();
        this.log.info(lines[0]);

        svc_devConsole.remove_widget(this.widget_);
        this.widget_ = null;
    }

    _register_commands (commands) {
        commands.registerCommands('minlog', [
            {
                id: 'on',
                handler: async (args, log) => {
                    this.on = true;
                }
            },
            {
                id: 'off',
                handler: async (args, log) => {
                    this.rm_dev_console_widget_();
                    this.on = false;
                }
            },
            {
                id: 'show',
                handler: async (args, log) => {
                    const [ name ] = args;

                    this.visible.add(name);
                }
            },
            {
                id: 'hide',
                handler: async (args, log) => {
                    const [ name ] = args;

                    this.visible.delete(name);
                }
            },
        ]);
    }
}

module.exports = MinLogService;
