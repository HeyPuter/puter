const BaseService = require("./BaseService");

const DENY_SERVICE_INSTRUCTION = Symbol('DENY_SERVICE_INSTRUCTION');

class AnomalyService extends BaseService {
    _construct () {
        this.types = {};
    }
    register (type, config) {
        const type_instance = {
            config,
        }
        if ( config.handler ) {
            type_instance.handler = config.handler;
        } else if ( config.high ) {
            type_instance.handler = data => {
                if ( data.value > config.high ) {
                    return new Set([DENY_SERVICE_INSTRUCTION]);
                }
            }
        }
        this.types[type] = type_instance;
    }
    async note (id, data) {
        const type = this.types[id];
        if ( ! type ) return;
        
        return type.handler(data);
    }
}

module.exports = {
    AnomalyService,
    DENY_SERVICE_INSTRUCTION,
};
