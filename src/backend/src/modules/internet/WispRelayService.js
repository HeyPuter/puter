const BaseService = require('../../services/BaseService');

class WispRelayService extends BaseService {
    _init () {
        const path_ = require('path');
        const svc_process = this.services.get('process');
        svc_process.start({
            name: 'internet.js',
            command: this.config.node_path,
            fullpath: this.config.wisp_relay_path,
            args: ['index.js'],
            env: {
                PORT: this.config.wisp_relay_port,
                WISP_AUTH_SERVER: this.config.origin,
            },
        });
    }
}

module.exports = WispRelayService;
