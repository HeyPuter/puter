export class Debug {
    constructor (context, parameters) {
        this.context = context;
        this.parameters = parameters;

        this._init();
    }

    _init () {
        // Check query parameter 'enabled_logs'
        const url = new URL(location.href);
        let enabled_logs = url.searchParams.get('enabled_logs');
        if ( ! enabled_logs ) enabled_logs = '';
        enabled_logs = enabled_logs.split(';');
        for ( const category of enabled_logs ) {
            if ( category === '' ) continue;
            this.context.puter.logger.on(category);
        }

        globalThis.addEventListener('message', async e => {
            // Ensure message is from parent window
            if ( e.source !== globalThis.parent ) return;
            // (parent window is allowed to be anything)

            // Check if it's a debug message
            if ( ! e.data.$ ) return;
            if ( e.data.$ !== 'puterjs-debug' ) return;

            // It's okay to log this; it will only show if a
            // developer does something in the console.
            console.log('Got a puter.js debug event!', e.data);

            if ( e.data.cmd === 'log.on' ) {
                console.log('Got instruction to turn logs on!');
                this.context.puter.logger.on(e.data.category);
            }
        })
    }
}
