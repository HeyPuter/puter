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
const { AdvancedBase } = require("@heyputer/putility");
const { Context } = require('../util/context')
const APIError = require("../api/APIError");
const { AppUnderUserActorType, UserActorType } = require("../services/auth/Actor");
const { BaseOperation } = require("../services/OperationTraceService");
const { CodeUtil } = require("../codex/CodeUtil");

/**
 * Base class for all driver implementations.
 * 
 * @deprecated - we use traits on services now. This class is kept for compatibility
 * with EntityStoreImplementation and DBKVStore which still use this.
 */
class Driver extends AdvancedBase {
    constructor (...a) {
        super(...a);
        const methods = this._get_merged_static_object('METHODS');
        // Turn each method into an operation
        for ( const k in methods ) {
            methods[k] = CodeUtil.mrwrap(methods[k], BaseOperation, {
                name: `${this.constructor.ID}:${k}`,
            });
        };
        this.methods = methods;
        this.sla = this._get_merged_static_object('SLA');
    }

    async call (method, args) {
        if ( ! this.methods[method] ) {
            throw new Error(`method not found: ${method}`);
        }

        const pseudo_this = Object.assign({}, this);

        const context = Context.get();
        pseudo_this.context = context;
        pseudo_this.services = context.get('services');
        const services = context.get('services');
        pseudo_this.log = services.get('log-service').create(this.constructor.name);

        await this._sla_enforcement(method);

        return await this.methods[method].call(pseudo_this, args);
    }

    async _sla_enforcement (method) {
        const context = Context.get();
        const services = context.get('services');
        const method_key = `${this.constructor.ID}:${method}`;
        const svc_sla = services.get('sla');

        // System SLA enforcement
        {
            const sla_key = `driver:impl:${method_key}`;
            const sla = await svc_sla.get('system', sla_key);

            const sys_method_key = `system:${method_key}`;

            // short-term rate limiting
            if ( sla?.rate_limit ) {
                const svc_rateLimit = services.get('rate-limit');
                let eventual_success = false;
                for ( let i = 0 ; i < 60 ; i++ ) {
                    try {
                        await svc_rateLimit.check_and_increment(sys_method_key, sla.rate_limit.max, sla.rate_limit.period);
                        eventual_success = true;
                        break;
                    } catch ( e ) {
                        if (
                            ! ( e instanceof APIError ) ||
                            e.fields.code !== 'rate_limit_exceeded'
                        ) throw e;
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
                if ( ! eventual_success ) {
                    throw APIError.create('server_rate_exceeded');
                }
            }
        }

        // test_mode is checked to prevent rate limiting when it is enabled
        const test_mode = context.get('test_mode');

        // User SLA enforcement
        {
            const actor = context.get('actor').get_related_actor(UserActorType);

            const user_is_verified = !! actor.type.user.email_confirmed;

            const sla_key = `driver:impl:${method_key}`;
            const sla = await svc_sla.get(
                user_is_verified ? 'user_verified' : 'user_unverified',
                sla_key
            );

            // short-term rate limiting
            if ( sla?.rate_limit ) {
                const svc_rateLimit = services.get('rate-limit');
                await svc_rateLimit.check_and_increment(method_key, sla.rate_limit.max, sla.rate_limit.period);
            }

            // long-term rate limiting
            if ( sla?.monthly_limit && ! test_mode ) {
                const svc_monthlyUsage = services.get('monthly-usage');
                const count = await svc_monthlyUsage.check(
                    actor, {
                        'driver.interface': this.constructor.INTERFACE,
                        'driver.implementation': this.constructor.ID,
                        'driver.method': method,
                    });
                if ( count >= sla.monthly_limit ) {
                    throw APIError.create('monthly_limit_exceeded', null, {
                        method_key,
                        limit: sla.monthly_limit,
                    });
                }
            }
        }

        // App SLA enforcement
        await (async () => {
            const actor = context.get('actor');
            if ( ! ( actor.type instanceof AppUnderUserActorType ) ) return;

            const sla_key = `driver:impl:${method_key}`;
            const sla = await svc_sla.get('app_default', sla_key);

            // long-term rate limiting
            if ( sla?.monthly_limit && ! test_mode ) {
                const svc_monthlyUsage = services.get('monthly-usage');
                const count = await svc_monthlyUsage.check(
                    actor, {
                        'driver.interface': this.constructor.INTERFACE,
                        'driver.implementation': this.constructor.ID,
                        'driver.method': method,
                    });
                if ( count >= sla.monthly_limit ) {
                    throw APIError.create('monthly_limit_exceeded', null, {
                        method_key,
                        limit: sla.monthly_limit,
                    });
                }
            }
        })();

        // Record monthly usage
        if ( ! test_mode ) {
            const actor = context.get('actor');
            const svc_monthlyUsage = services.get('monthly-usage');
            const extra = {
                'driver.interface': this.constructor.INTERFACE,
                'driver.implementation': this.constructor.ID,
                'driver.method': method,
                ...(this.get_usage_extra ? this.get_usage_extra() : {}),
            };
            await svc_monthlyUsage.increment(actor, method_key, extra);
        }
    }

    async get_response_meta () {
        return {
            driver: this.constructor.ID,
            driver_version: this.constructor.VERSION,
            driver_interface: this.constructor.INTERFACE,
        };
    }
}

module.exports = {
    Driver,
};
