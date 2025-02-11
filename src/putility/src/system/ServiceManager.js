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

const { AdvancedBase } = require("../AdvancedBase");
const { TService } = require("../concepts/Service");
const { TeePromise } = require("../libs/promise");

const mkstatus = name => {
    const c = class {
        get label () { return name }
        describe () { return name }
    }
    c.name = `Status${
        name[0].toUpperCase() + name.slice(1)
    }`
    return c;
}

class ServiceManager extends AdvancedBase {
    static StatusRegistering = mkstatus('registering');
    static StatusPending = class StatusPending {
        constructor ({ waiting_for }) {
            this.waiting_for = waiting_for;
        }
        get label () { return 'waiting'; }
        // TODO: trait?
        describe () {
            return `waiting for: ${this.waiting_for.join(', ')}`
        }
    }
    static StatusInitializing = mkstatus('initializing');
    static StatusRunning = class StatusRunning {
        constructor ({ start_ts }) {
            this.start_ts = start_ts;
        }
        get label () { return 'running'; }
        describe () {
            return `running (since ${this.start_ts})`;
        }
    }
    constructor ({ context } = {}) {
        super();

        this.context = context;

        this.services_l_ = [];
        this.services_m_ = {};
        this.service_infos_ = {};

        this.init_listeners_ = [];
        // services which are waiting for dependency servicces to be
        // initialized; mapped like: waiting_[dependency] = Set(dependents)
        this.waiting_ = {};
    }
    async register (name, factory, options = {}) {
        await new Promise(rslv => setTimeout(rslv, 0));

        const ins = factory.create({
            parameters: options.parameters ?? {},
            context: this.context,
        });
        const entry = {
            name,
            instance: ins,
            status: new this.constructor.StatusRegistering(),
        };
        this.services_l_.push(entry);
        this.services_m_[name] = entry;

        await this.maybe_init_(name);
    }
    info (name) {
        return this.services_m_[name];
    }
    get (name) {
        const info = this.services_m_[name];
        if ( ! info ) throw new Error(`Service not registered: ${name}`);
        if ( ! (info.status instanceof this.constructor.StatusRunning ) ) {
            return undefined;
        }
        return info.instance;
    }
    async aget (name) {
        await this.wait_for_init([name]);
        return this.get(name);
    }

    /**
     * Wait for the specified list of services to be initialized.
     * @param {*} depends - list of services to wait for
     */
    async wait_for_init (depends) {
        let check;

        await new Promise(rslv => {
            check = () => {
                // Get the list of required services that are not
                // yet initialized
                const waiting_for = this.get_waiting_for_(depends);

                // If there's nothing to wait for, remove the listener
                // on service initializations and resolve
                if ( waiting_for.length === 0 ) {
                    const i = this.init_listeners_.indexOf(check);
                    if ( i !== -1 ) {
                        this.init_listeners_.splice(i, 1);
                    }
                    rslv();

                    return true;
                }
            };

            // Services might already be registered
            if ( check() ) return;

            this.init_listeners_.push(check);
        });
    };

    get_waiting_for_ (depends) {
        const waiting_for = [];
        for ( const depend of depends ) {
            const depend_entry = this.services_m_[depend];
            if ( ! depend_entry ) {
                waiting_for.push(depend);
                continue;
            }
            if ( ! (depend_entry.status instanceof this.constructor.StatusRunning) ) {
                waiting_for.push(depend);
            }
        }
        return waiting_for;
    }

    async maybe_init_ (name) {
        const entry = this.services_m_[name];
        const depends = entry.instance.as(TService).get_depends();
        const waiting_for = this.get_waiting_for_(depends);

        if ( waiting_for.length === 0 ) {
            await this.init_service_(name);
            return;
        }

        for ( const dependency of waiting_for ) {
            /** @type Set */
            const waiting_set = this.waiting_[dependency] ||
                (this.waiting_[dependency] = new Set());
            waiting_set.add(name);
        }

        entry.status = new this.constructor.StatusPending(
            { waiting_for });
    }

    // called when a service has all of its dependencies initialized
    // and is ready to be initialized itself
    async init_service_ (name, modifiers = {}) {
        const entry = this.services_m_[name];
        entry.status = new this.constructor.StatusInitializing();

        const service_impl = entry.instance.as(TService);
        await service_impl.init();
        entry.status = new this.constructor.StatusRunning({
            start_ts: new Date(),
        });
        /** @type Set */
        const maybe_ready_set = this.waiting_[name];
        const promises = [];
        if ( maybe_ready_set ) {
            for ( const dependent of maybe_ready_set.values() ) {
                promises.push(this.maybe_init_(dependent, {
                    no_init_listeners: true
                }));
            }
        }
        await Promise.all(promises);

        if ( ! modifiers.no_init_listeners ) {
            for ( const lis of this.init_listeners_ ) {
                await lis();
            }
        }
    }
}

module.exports = {
    ServiceManager,
};
