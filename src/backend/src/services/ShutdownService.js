const BaseService = require("./BaseService");

class ShutdownService extends BaseService {
    shutdown ({ reason, code } = {}) {
        this.log.info(`Puter is shutting down: ${reason ?? 'no reason provided'}`);
        process.stdout.write('\x1B[0m\r\n');
        process.exit(code ?? 0);
    }
}

module.exports = { ShutdownService };
