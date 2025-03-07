const BaseService = require("./BaseService");

const os = require('os');

class HostnameService extends BaseService {
    _construct () {
        this.entries = {};
    }
    
    _init () {
        if ( this.global_config.domain ) {
            this.entries[this.global_config.domain] = {
                scope: 'web',
            };
            this.entries[`api.${this.global_config.domain}`] = {
                scope: 'api',
            };
        }
        
        const addresses = this.get_broadcast_addresses();
        
        if ( ! this.global_config.no_nip ) {
            //
        }
    }
    
    get_broadcast_addresses () {
        const ifaces = os.networkInterfaces();
        
        for ( const iface_key in ifaces ) {
            console.log('iface_key', iface_key);
        }
    }
}

module.exports = { HostnameService };
