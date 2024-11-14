import { Service } from "../definitions.js";

export class DebugService extends Service {
    async _init () {
        // Track enabled log categories
        this.enabled_logs = [];

        // Provide enabled logs as a query param
        const svc_exec = this.services.get('exec');
        svc_exec.register_param_provider(() => {
            return {
                ...(this.enabled_logs.length > 0
                    ? { enabled_logs: this.enabled_logs.join(';') }
                    : {}
                ),
            };
        });
    }
    logs(category) {
        const msg = {
            $: 'puterjs-debug',
            cmd: 'log.on',
            category,
        };
        this.enabled_logs.push(category);
        puter.log.on(category);
        $('iframe').each(function () {
            this.contentWindow.postMessage(msg);
        });
    }
}
