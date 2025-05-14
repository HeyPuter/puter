const { get_user } = require("../../helpers");
const BaseService = require("../../services/BaseService");

class DomainVerificationService extends BaseService {
    _init () {
        this._register_commands();
    }
    async get_controlling_user ({ domain }) {
        const svc_event = this.services.get('event');
        
        // 1 :: Allow event listeners to verify domains
        const event = {
            domain,
            user: undefined,
        };
        await svc_event.emit('domain.get-controlling-user', event);
        if ( event.user ) {
            return event.user;
        }
        
        // 2 :: If there is no controlling user, 'admin' is the
        //      controlling user.
        return await get_user({ username: 'admin' });
    }

    _register_commands (commands) {
        const svc_commands = this.services.get('commands');
        svc_commands.registerCommands('domain', [
            {
                id: 'user',
                description: '',
                handler: async (args, log) => {
                    const res = await this.get_controlling_user({ domain: args[0] });
                    log.log(res);
                }
            }
        ]);
    }
}

module.exports = {
    DomainVerificationService,
};
