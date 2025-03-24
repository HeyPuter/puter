export default class Threads {
    constructor (context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
    }
    setAuthToken (authToken) {
        this.authToken = authToken;
    }
    setAPIOrigin (APIOrigin) {
        this.APIOrigin = APIOrigin;
    }
    async req_ (method, route, body) {
        const resp = await fetch(
            this.APIOrigin + route, {
                method,
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            }
        );
        return await resp.json();
    }
    
    async create (spec, parent) {
        if ( typeof spec === 'string' ) spec = { text: spec };
        return await this.req_('POST', '/threads/create', {
            ...spec,
            ...(parent ? { parent } : {}),
        });
    }
    
    async edit (uid, spec = {}) {
        if ( typeof spec === 'string' ) spec = { text: spec };
        await this.req_('PUT', '/threads/edit/' + encodeURIComponent(uid), {
            ...spec,
        });
    }
    
    async delete (uid) {
        await this.req_('DELETE', '/threads/' + encodeURIComponent(uid));
    }
    
    async list (uid, page, options) {
        return await this.req_('POST',
            '/threads/list/' + encodeURIComponent(uid) + '/' + page,
            options ?? {},
        );
    }

    async subscribe (uid, callback) {
        puter.fs.socket.emit('thread.sub-request', { uid });

        // socket.io, which we use unfortunatelly, doesn't handle
        // wildcard events, so we have to just put them all here.
        const events = [
            'post', 'edit', 'delete', 'child-edit', 'child-delete',
        ];

        for ( const event of events ) {
            puter.fs.socket.on(`thread.${event}`, (data) => {
                if ( data.subscription === uid ) callback(event, data);
            });
        }
    }
}
