import { match } from 'path-to-regexp';

function inits2w() {
    // s2w router itself: Not part of any package, just a simple router.
    const s2w = {
        routing: true,
        map: new Map(),
        custom(eventName, route, eventListener) {
            const matchExp = match(route);
            if (!this.map.has(eventName)) {
                this.map.set(eventName, [[matchExp, eventListener]])
            } else {
                this.map.get(eventName).push([matchExp, eventListener])
            }
        },
        get(...args) {
            this.custom("GET", ...args)
        },
        post(...args) {
            this.custom("POST", ...args)
        },
        options(...args) {
            this.custom("OPTIONS", ...args)
        },
        put(...args) {
            this.custom("PUT", ...args)
        },
        delete(...args) {
            this.custom("DELETE", ...args)
        },
        async route(event) {
            if (!globalThis.puter) {
                console.log("Puter not loaded, initializing...");
                const success = init_puter_portable(globalThis.puter_auth, globalThis.puter_endpoint || "https://api.puter.com");
                console.log("Puter.js initialized successfully");
            }
            
            const mappings = this.map.get(event.request.method);
            const url = new URL(event.request.url);
            try {
                for (const mapping of mappings) {
                    // return new Response(JSON.stringify(mapping))
                    const results = mapping[0](url.pathname)
                    if (results) {
                        event.params = results.params;
                        return mapping[1](event);
                    }
                }
            } catch (e) {
                return new Response(e, {status: 500, statusText: "Server Error"})
            }

            return new Response("Path not found", {status: 404, statusText: "Not found"});
        }
    }
    globalThis.s2w = s2w;
    self.addEventListener("fetch", (event)=> {
        if (!s2w.routing)
            return false;
        event.respondWith(s2w.route(event));
    })
}

export default inits2w; 