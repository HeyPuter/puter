const { get_user } = require("../../helpers");
const BaseService = require("../../services/BaseService");

class DomainVerificationService extends BaseService {
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
}

module.exports = {
    DomainVerificationService,
};
