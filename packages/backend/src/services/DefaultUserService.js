const { surrounding_box } = require("../fun/dev-console-ui-utils");
const { get_user, generate_system_fsentries } = require("../helpers");
const { asyncSafeSetInterval } = require("../util/promise");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

const DEFAULT_PASSWORD = 'changeme';
const USERNAME = 'default_user';

class DefaultUserService extends BaseService {
    static MODULES = {
        bcrypt: require('bcrypt'),
        uuidv4: require('uuid').v4,
    }
    async _init () {
    }
    async ['__on_ready.webserver'] () {
        // check if a user named `default-user` exists
        let user = await get_user({ username: USERNAME });
        if ( ! user ) user = await this.create_default_user_();

        // check if user named `default-user` is using default password
        const require = this.require;
        const bcrypt = require('bcrypt');
        const is_default_password = await bcrypt.compare(DEFAULT_PASSWORD, user.password);
        if ( ! is_default_password ) return;

        // show console widget
        this.default_user_widget = () => {
            const lines = [
                `Your default user has been created!`,
                `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
                `\x1B[32;1mpassword:\x1B[0m ${DEFAULT_PASSWORD}`,
                `(change the password to remove this message)`
            ];
            surrounding_box('31;1', lines);
            return lines;
        };
        this.start_poll_();
        const svc_devConsole = this.services.get('dev-console');
        svc_devConsole.add_widget(this.default_user_widget);
    }
    start_poll_ () {
        const interval = 1000 * 3; // 3 seconds
        const poll_interval = asyncSafeSetInterval(async () => {
            const user = await get_user({ username: USERNAME });
            const require = this.require;
            const bcrypt = require('bcrypt');
            const is_default_password = await bcrypt.compare(DEFAULT_PASSWORD, user.password);
            if ( ! is_default_password ) {
                const svc_devConsole = this.services.get('dev-console');
                svc_devConsole.remove_widget(this.default_user_widget);
                clearInterval(poll_interval);
                return;
            }
        }, interval);
    }
    async create_default_user_ () {
        const require = this.require;
        const bcrypt = require('bcrypt');
        const db = this.services.get('database').get(DB_WRITE, 'default-user');
        await db.write(
            `
                INSERT INTO user (uuid, username, password, free_storage)
                VALUES (?, ?, ?, ?)
            `,
            [
                this.modules.uuidv4(),
                USERNAME,
                await bcrypt.hash(DEFAULT_PASSWORD, 8),
                1024 * 1024 * 1024 * 10, // 10 GB
            ],
        );
        const user = await get_user({ username: USERNAME });
        await generate_system_fsentries(user);
        return user;
    }
}

module.exports = DefaultUserService;
