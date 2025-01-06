/*
 * Copyright (C) 2024 Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
