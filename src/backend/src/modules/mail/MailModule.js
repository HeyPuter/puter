const { AdvancedBase } = require("@heyputer/putility");

class MailModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { UserSendMailService } = require('./UserSendMailService');
        services.registerService('user-send-mail', UserSendMailService);
    }
}

module.exports = {
    MailModule,
};
