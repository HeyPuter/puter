/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
const { AdvancedBase } = require('@heyputer/putility');
const { WeakConstructorFeature } = require('../../traits/WeakConstructorFeature');
const { Context } = require('../../util/context');

/**
 * BaseES is a base class for Entity Store classes.
 */
class BaseES extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ];

    // Default implementations
    static METHODS = {
        async upsert (entity, extra) {
            if ( ! this.upstream ) {
                throw Error('Missing terminal operation');
            }
            return await this.upstream.upsert(entity, extra);
        },
        async read (uid) {
            if ( ! this.upstream ) {
                throw Error('Missing terminal operation');
            }
            return await this.upstream.read(uid);
        },
        async delete (uid, extra) {
            if ( ! this.upstream ) {
                throw Error('Missing terminal operation');
            }
            return await this.upstream.delete(uid, extra);
        },
        async select (options) {
            if ( ! this.upstream ) {
                throw Error('Missing terminal operation');
            }
            return await this.upstream.select(options);
        },
        async create_predicate (id, ...args) {
            if ( ! this.upstream ) {
                throw Error('Missing terminal operation');
            }
            return await this.upstream.create_predicate(id, ...args);
        },
    };

    constructor (...a) {
        super(...a);

        const public_wrappers = [
            'upsert', 'read', 'delete', 'select',
            'read_transform',
            'retry_predicate_rewrite',
        ];

        this.impl_methods = this._get_merged_static_object('METHODS');

        for ( const k in this.impl_methods ) {
            // Some methods are part of the implicit EntityStorage interface.
            // We won't let the implementor override these; instead we
            // provide a delegating implementation where they override a
            // lower-level method of the same name.
            if ( public_wrappers.includes(k) ) continue;

            this[k] = this.impl_methods[k];
        }

        this.log = Context.get('services').get('log-service')
            .create(`ES:${this.entity_name}:${this.constructor.name}`, {
                concern: 'es',
            });
    }

    async provide_context ( args ) {
        for ( const k in args ) this[k] = args[k];
        if ( this.upstream ) {
            await this.upstream.provide_context(args);
        }
        if ( this._on_context_provided ) {
            await this._on_context_provided(args);
        }

        this.log = Context.get('services').get('log-service')
            .create(`ES:${this.entity_name}:${this.constructor.name}`);
    }
    async read (uid) {
        let entity = await this.call_on_impl_('read', uid);
        if ( ! entity ) {
            const retry_predicate = await this.retry_predicate_rewrite(uid);
            if ( retry_predicate ) {
                entity = await this.call_on_impl_('read',
                                { predicate: retry_predicate });
            }
        }
        if ( ! this.impl_methods.read_transform ) return entity;
        return await this.read_transform(entity);
    }
    async upsert (entity, extra) {
        return await this.call_on_impl_('upsert', entity, extra ?? {});
    }
    async delete (uid, extra) {
        return await this.call_on_impl_('delete', uid, extra ?? {});
    }

    async select (options) {

        const results = await this.call_on_impl_('select', options);
        if ( ! this.impl_methods.read_transform ) return results;

        // Promises "solved callback hell" but like...
        return await Promise.all(results.map(async entity => {
            return await this.read_transform(entity);
        }));
    }

    async retry_predicate_rewrite ({ predicate }) {
        if ( ! this.impl_methods.retry_predicate_rewrite ) return;
        return await this.call_on_impl_('retry_predicate_rewrite', { predicate });
    }

    async read_transform (entity) {
        if ( ! entity ) return entity;
        if ( ! this.impl_methods.read_transform ) return entity;
        const maybe_entity = await this.call_on_impl_('read_transform', entity);
        if ( ! maybe_entity ) return entity;
        return maybe_entity;
    }

    call_on_impl_ (method_name, ...args) {
        // const pseudo_this = { ...this };
        // pseudo_this.next = this.upstream?.call_on_impl?.bind(this.upstream, method_name);
        return this.impl_methods[method_name].call(this, ...args);
    }
}

module.exports = {
    BaseES,
};
