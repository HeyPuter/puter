import UIAlert from "../UI/UIAlert.js";

import { Service } from "../definitions.js";

export class LaunchOnInitService extends Service {
    _construct () {
        this.commands = {
            'window-call': ({ fn_name, args }) => {
                window[fn_name](...args);
            }
        };
    }
    async _init () {
        const launch_options = this.$puter.gui_params.launch_options;
        if ( ! launch_options ) return;

        if ( launch_options.on_initialized ) {
            for ( const command of launch_options.on_initialized ) {
                console.log('running', command)
                this.run_(command);
            }
        }
    }

    run_ (command) {
        const args = { ...command };
        delete args.$;
        this.commands[command.$](args);
    }
}
