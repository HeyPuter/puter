const { get_user } = require("../helpers");
const BaseService = require("./BaseService");

class VerifiedGroupService extends BaseService {
    async _init () {
        const config = this.global_config;

        const svc_event = this.services.get('event');
        svc_event.on('user.email-confirmed', async (_, { user_uid }) => {
            const user = await get_user({ uuid: user_uid });
            
            // Update group
            const svc_group = this.services.get('group');
            await svc_group.remove_users({
                uid: config.default_temp_group,
                users: [user.username],
            });
            await svc_group.add_users({
                uid: config.default_user_group,
                users: [user.username]
            });
        });
    }
}

module.exports = {
    VerifiedGroupService,
};
