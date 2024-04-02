const { surrounding_box } = require("../fun/dev-console-ui-utils");
const { get_user, generate_system_fsentries, invalidate_cached_user } = require("../helpers");
const { Context } = require("../util/context");
const { asyncSafeSetInterval } = require("../util/promise");
const BaseService = require("./BaseService");
const { Actor, UserActorType } = require("./auth/Actor");
const { DB_WRITE } = require("./database/consts");

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
        let user = await get_user({ username: USERNAME, cached: false });
        if ( ! user ) user = await this.create_default_user_();

        // check if user named `default-user` is using default password
        const require = this.require;
        const tmp_password = await this.get_tmp_password_(user);
        const bcrypt = require('bcrypt');
        console.log(
            'VALUES',
            tmp_password,
            user.password,
        );
        const is_default_password = await bcrypt.compare(
            tmp_password,
            user.password
        );
        if ( ! is_default_password ) return;

        // show console widget
        this.default_user_widget = () => {
            const lines = [
                `Your default user has been created!`,
                `\x1B[31;1musername:\x1B[0m ${USERNAME}`,
                `\x1B[32;1mpassword:\x1B[0m ${tmp_password}`,
                `(change the password to remove this message)`
            ];
            surrounding_box('31;1', lines);
            return lines;
        };
        this.start_poll_({ tmp_password, user });
        const svc_devConsole = this.services.get('dev-console');
        svc_devConsole.add_widget(this.default_user_widget);
    }
    start_poll_ ({ tmp_password, user }) {
        const interval = 1000 * 3; // 3 seconds
        const poll_interval = asyncSafeSetInterval(async () => {
            const user = await get_user({ username: USERNAME });
            const require = this.require;
            const bcrypt = require('bcrypt');
            const is_default_password = await bcrypt.compare(
                tmp_password,
                user.password
            );
            if ( ! is_default_password ) {
                const svc_devConsole = this.services.get('dev-console');
                svc_devConsole.remove_widget(this.default_user_widget);
                clearInterval(poll_interval);
                return;
            }
        }, interval);
    }
    async create_default_user_ () {
        const db = this.services.get('database').get(DB_WRITE, 'default-user');
        await db.write(
            `
                INSERT INTO user (uuid, username, free_storage)
                VALUES (?, ?, ?)
            `,
            [
                this.modules.uuidv4(),
                USERNAME,
                1024 * 1024 * 1024 * 10, // 10 GB
            ],
        );
        const user = await get_user({ username: USERNAME });
        const tmp_password = await this.get_tmp_password_(user);
        const bcrypt = require('bcrypt');
        const password_hashed = await bcrypt.hash(tmp_password, 8);
        await db.write(
            `UPDATE user SET password = ? WHERE id = ?`,
            [
                password_hashed,
                user.id,
            ],
        );
        user.password = password_hashed;
        await generate_system_fsentries(user);
        invalidate_cached_user(user);
        await new Promise(rslv => setTimeout(rslv, 2000));
        return user;
    }
    async get_tmp_password_ (user) {
        const actor = await Actor.create(UserActorType, { user });
        return await Context.get().sub({ actor }).arun(async () => {
            const svc_driver = this.services.get('driver');
            const driver_response = await svc_driver.call(
                'puter-kvstore', 'get', { key: 'tmp_password' });

            if ( driver_response.result ) return driver_response.result;

            const tmp_password = require('crypto').randomBytes(4).toString('hex');
            await svc_driver.call(
                'puter-kvstore', 'set', {
                    key: 'tmp_password',
                    value: tmp_password });
            return tmp_password;
        });
    }
}

module.exports = DefaultUserService;
