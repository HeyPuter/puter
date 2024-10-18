const { AdvancedBase } = require("../AdvancedBase");
const { TService } = require("../concepts/Service");

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
    constructor () {
        super();

        this.services_l_ = [];
        this.services_m_ = {};
        this.service_infos_ = {};

        this.init_listeners_ = {};
        // services which are waiting for dependency servicces to be
        // initialized; mapped like: waiting_[dependency] = Set(dependents)
        this.waiting_ = {};
    }
    async register (name, factory, options = {}) {
        const ins = factory.create({
            parameters: options.parameters ?? {},
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

    async maybe_init_ (name) {
        const entry = this.services_m_[name];
        const depends = entry.instance.get_depends();
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
    async init_service_ (name) {
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
                promises.push(this.maybe_init_(dependent));
            }
        }
        await Promise.all(promises);
    }
}

module.exports = {
    ServiceManager,
};
