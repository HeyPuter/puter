/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { TeePromise } = require("../util/promise");
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
        express: require('express'),
    }

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
                    
                    res.json({});
                }
            }).attach(router);
        });
    }
    
    async on_user_connected ({ user }) {
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
};
