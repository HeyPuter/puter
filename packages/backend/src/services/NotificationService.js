const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

const UsernameNotifSelector = username => async (self) => {
    const svc_getUser = self.services.get('get-user');
    const user = await svc_getUser.get_user({ username });
    return [user.id];
};

class NotificationService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }

    async _init () {
        const svc_database = this.services.get('database');
        this.db = svc_database.get(DB_WRITE, 'notification');
        
        const svc_script = this.services.get('script');
        svc_script.register('test-notification', async ({ log }, [username, summary]) => {
            log('creating notification: ' + summary);
            
            this.notify(UsernameNotifSelector(username), { summary });
        });
    }
    async notify (selector, notification) {
        const uid = this.modules.uuidv4();
        const svc_event = this.services.get('event');
        const user_id_list = await selector(this);
        svc_event.emit('outer.gui.notif.message', {
            user_id_list,
            response: {
                uid,
                notification,
            },
        });
        
        const ll = o => {
            this.log.noticeme('debug: ' + require('node:util').inspect(o));
            return o;
        };
        
        (async () => {
            for ( const user_id of user_id_list ) {
                await this.db.write(...ll([
                    'INSERT INTO `notification` ' +
                    '(`user_id`, `uid`, `value`) ' +
                    'VALUES (?, ?, ?)',
                    [user_id, uid, JSON.stringify(notification)],
                ]));
            }
            svc_event.emit('outer.gui.notif.persisted', {
                user_id_list,
                response: {
                    uid,
                },
            });
        })();
    }
}

module.exports = {
    NotificationService,
    UsernameNotifSelector,
};
