// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const APIError = require("../api/APIError");
const auth2 = require("../middleware/auth2");
const { Endpoint } = require("../util/expressutil");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

const UsernameNotifSelector = username => async (self) => {
    const svc_getUser = self.services.get('get-user');
    const user = await svc_getUser.get_user({ username });
    return [user.id];
};

const UserIDNotifSelector = user_id => async (self) => {
    return [user_id];
};


/**
* @class NotificationService
* @extends BaseService
*
* The NotificationService class is responsible for managing notifications within the application.
* It handles creating, storing, and sending notifications to users, as well as updating the status of notifications
* (e.g., marking them as read or acknowledged).
*
* @property {Object} MODULES - Static object containing modules used by the service, such as uuidv4 and express.
* @property {Object} merged_on_user_connected_ - Object to track connected users and manage delayed actions.
* @property {Object} notifs_pending_write - Object to track pending write operations for notifications.
*
* @method _construct - Initializes the service's internal state.
* @method _init - Initializes the service, setting up database connections and event listeners.
* @method __on_install.routes - Registers API routes for notification-related endpoints.
* @method on_user_connected - Handles actions when a user connects to the application.
* @method do_on_user_connected - Queries and updates unread notifications for a connected user.
* @method on_sent_to_user - Updates the status of a notification when it is sent to a user.
* @method notify - Sends a notification to a list of users and persists it in the database.
*
* @example
* const notificationService = new NotificationService();
* notificationService.notify(UsernameNotifSelector('user123'), {
*   source: 'notification-testing',
*   icon_source: 'builtin',
*   icon: 'logo.svg',
*   title: 'Test Notification',
*   text: 'This is a test notification.'
* });
*/
class NotificationService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
        express: require('express'),
    }


    /**
    * Constructs the NotificationService instance.
    * This method sets up the initial state of the service, including any necessary
    * data structures or configurations.
    *
    * @private
    */
    _construct () {
        this.merged_on_user_connected_ = {};
    }


    /**
    * Initializes the NotificationService by setting up necessary services,
    * registering event listeners, and preparing the database connection.
    * This method is called once during the service's lifecycle.
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
    async _init () {
        const svc_database = this.services.get('database');
        this.db = svc_database.get(DB_WRITE, 'notification');
        
        const svc_script = this.services.get('script');
        svc_script.register('test-notification', async ({ log }, [username, summary]) => {
            log('creating notification: ' + summary);
            
            this.notify(UsernameNotifSelector(username), {
                source: 'notification-testing',
                icon_source: 'builtin',
                icon: 'logo.svg',
                title: summary,
                text: summary,
            });
        });
        
        const svc_event = this.services.get('event');
        svc_event.on('web.socket.user-connected', (_, { user }) => {
            this.on_user_connected({ user });
        });
        svc_event.on('sent-to-user.notif.message', (_, o) => {
            this.on_sent_to_user(o);
        })
        
        this.notifs_pending_write = {};
    }
    
    ['__on_install.routes'] (_, { app }) {
        const require = this.require;
        const express = require('express');
        const router = express.Router();
        app.use('/notif', router);
        
        router.use(auth2);

        const svc_event = this.services.get('event');
        
        [['ack','acknowledged'],['read','read']].forEach(([ep_name, col_name]) => {
            Endpoint({
                route: '/mark-' + ep_name,
                methods: ['POST'],
                handler: async (req, res) => {
                    // TODO: validate uid
                    if ( typeof req.body.uid !== 'string' ) {
                        throw APIError.create('field_invalid', null, {
                            key: 'uid',
                            expected: 'a valid UUID',
                            got: 'non-string value'
                        })
                    }
                    
                    const ack_ts = Math.floor(Date.now() / 1000);
                    await this.db.write(
                        'UPDATE `notification` SET ' + col_name + ' = ? ' +
                        'WHERE uid = ? AND user_id = ? ' +
                        'LIMIT 1',
                        [ack_ts, req.body.uid, req.user.id],
                    );

                    svc_event.emit('outer.gui.notif.ack', {
                        user_id_list: [req.user.id],
                        response: {
                            uid: req.body.uid,
                        },
                    });
                    
                    res.json({});
                }
            }).attach(router);
        });
    }
    

    /**
    * Handles the event when a user connects.
    *
    * This method checks if there is a timeout set for the user's connection event and clears it if it exists.
    * If not, it sets a timeout to call `do_on_user_connected` after 2000 milliseconds.
    *
    * @param {object} params - The parameters object containing user data.
    * @param {object} params.user - The user object with a `uuid` property.
    *
    * @returns {void}
    */
    async on_user_connected ({ user }) {
        if ( this.merged_on_user_connected_[user.uuid] ) {
            clearTimeout(this.merged_on_user_connected_[user.uuid]);
        }
        this.merged_on_user_connected_[user.uuid] =
            /**
            * Schedules the `do_on_user_connected` method to be called after a delay.
            *
            * This method sets a timer to call `do_on_user_connected` after 2000 milliseconds.
            * If a timer already exists for the user, it clears the existing timer before setting a new one.
            */
            setTimeout(() => this.do_on_user_connected({ user }), 2000);
    }
    /**
    * Handles the event when a user connects.
    * Sets a timeout to delay the execution of the `do_on_user_connected` method by 2 seconds.
    * This helps in merging multiple events that occur in a short period.
    *
    * @param {Object} obj - The event object containing user information.
    * @param {Object} obj.user - The user object with a `uuid` property.
    * @async
    */
    async do_on_user_connected ({ user }) {
        // query the users unread notifications
        const notifications = await this.db.read(
            'SELECT * FROM `notification` ' +
            'WHERE user_id=? AND shown IS NULL AND acknowledged IS NULL ' +
            'ORDER BY created_at ASC',
            [user.id]
        );

        // set all the notifications to "shown"
        const shown_ts = Math.floor(Date.now() / 1000);
        await this.db.write(
            'UPDATE `notification` ' +
            'SET shown = ? ' +
            'WHERE user_id=? AND shown IS NULL AND acknowledged IS NULL ',
            [shown_ts, user.id]
        );
        
        for ( const n of notifications ) {
            n.value = this.db.case({
                mysql: () => n.value,
                /**
                * Adjusts the value of a notification based on the database type.
                *
                * This method modifies the value of a notification to be JSON parsed
                * if the database is not MySQL.
                *
                * @returns {Object} The adjusted notification value.
                */
                otherwise: () => JSON.parse(n.value ?? '{}'),
            })();
        }
        
        const client_safe_notifications = [];
        for ( const notif of notifications ) {
            client_safe_notifications.push({
                uid: notif.uid,
                notification: notif.value,
            })
        }

        // send the unread notifications to gui
        const svc_event = this.services.get('event');
        svc_event.emit('outer.gui.notif.unreads', {
            user_id_list: [user.id],
            response: {
                unreads: client_safe_notifications,
            },
        });
    }
    

    /**
    * Handles the action when a notification is sent to a user.
    *
    * This method is triggered when a notification is sent to a user,
    * updating the notification's status to 'shown' in the database.
    * It logs the user ID and response, updates the 'shown' timestamp,
    * and ensures the notification is written to the database.
    *
    * @param {Object} params - The parameters containing the user ID and response.
    * @param {number} params.user_id - The ID of the user receiving the notification.
    * @param {Object} params.response - The response object containing the notification details.
    * @param {string} params.response.uid - The unique identifier of the notification.
    */
    async on_sent_to_user ({ user_id, response }) {
        console.log('GOT IT AND IT WORKED!!!', user_id, response);
        const shown_ts = Math.floor(Date.now() / 1000);
        if ( this.notifs_pending_write[response.uid] ) {
            await this.notifs_pending_write[response.uid];
        }
        await this.db.write(...ll([
            'UPDATE `notification` ' +
            'SET shown = ? ' +
            'WHERE user_id=? AND uid=?',
            [shown_ts, user_id, response.uid]
        ]));
    }
    

    /**
    * Sends a notification to specified users.
    *
    * This method sends a notification to a list of users determined by the provided selector.
    * It generates a unique identifier for the notification, emits an event to notify the GUI,
    * and inserts the notification into the database.
    *
    * @param {Function} selector - A function that takes the service instance and returns a list of user IDs.
    * @param {Object} notification - The notification details to be sent.
    */
    async notify (selector, notification) {
        const uid = this.modules.uuidv4();
        const svc_event = this.services.get('event');
        const user_id_list = await selector(this);
        this.notifs_pending_write[uid] = new TeePromise();
        svc_event.emit('outer.gui.notif.message', {
            user_id_list,
            response: {
                uid,
                notification,
            },
        });
        
        (async () => {
            for ( const user_id of user_id_list ) {
                await this.db.write(
                    'INSERT INTO `notification` ' +
                    '(`user_id`, `uid`, `value`) ' +
                    'VALUES (?, ?, ?)',
                    [user_id, uid, JSON.stringify(notification)],
                );
            }
            const p = this.notifs_pending_write[uid];
            delete this.notifs_pending_write[uid];
            p.resolve()
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
    UserIDNotifSelector,
};
