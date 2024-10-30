const CollectorHandle = (key, collector) => ({
    async get (route) {
        if ( collector.stored[key] ) return collector.stored[key];
        return await collector.fetch({ key, method: 'get', route });
    },
    async post (route, body) {
        if ( collector.stored[key] ) return collector.stored[key];
        return await collector.fetch({ key, method: 'post', route, body });
    }
})

// TODO: link this with kv.js for expiration handling
export default def(class Collector {
    constructor ({ antiCSRF, origin, authToken }) {
        this.antiCSRF = antiCSRF;
        this.origin = origin;
        this.authToken = authToken;
        this.stored = {};
    }

    to (name) {
        return CollectorHandle(name, this);
    }

    whats (key) {
        return this.stored[key];
    }

    async get (route) {
        return await this.fetch({ method: 'get', route });
    }
    async post (route, body = {}, options = {}) {
        if ( this.antiCSRF ) {
            body.anti_csrf = await this.antiCSRF.token();
        }
        return await this.fetch({ ...options, method: 'post', route, body });
    }

    discard (key) {
        if ( ! key ) this.stored = {};
        delete this.stored[key];
    }

    async fetch (options) {
        const fetchOptions = {
            method: options.method,
            headers: {
                Authorization: `Bearer ${this.authToken}`,
                'Content-Type': 'application/json',
            },
        };

        if ( options.method === 'post' ) {
            fetchOptions.body = JSON.stringify(
                options.body ?? {});
        }

        const maybe_slash = options.route.startsWith('/')
            ? '' : '/';

        const resp = await fetch(
            this.origin +maybe_slash+ options.route,
            fetchOptions,
        );
        
        if ( options.no_response ) return;
        const asJSON = await resp.json();

        if ( options.key ) this.stored[options.key] = asJSON;
        return asJSON;
    }
}, 'util.Collector');
