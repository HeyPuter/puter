// METADATA // {"ai-commented":{"service":"claude"}}
const BaseService = require("./BaseService");


/**
* Service responsible for handling graceful system shutdown operations.
* Extends BaseService to provide shutdown functionality with optional reason and exit code.
* Ensures proper cleanup and logging when the application needs to terminate.
* @class ShutdownService
* @extends BaseService
*/
class ShutdownService extends BaseService {
    shutdown ({ reason, code } = {}) {
        this.log.info(`Puter is shutting down: ${reason ?? 'no reason provided'}`);
        process.stdout.write('\x1B[0m\r\n');
        process.exit(code ?? 0);
    }
}

module.exports = { ShutdownService };
