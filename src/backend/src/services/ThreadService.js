const { PermissionImplicator, PermissionUtil } = require("./auth/PermissionService");
const BaseService = require("./BaseService")

const APIError = require("../api/APIError");
const { is_valid_uuid } = require("../helpers");
const { Context } = require("../util/context");
const { DB_WRITE } = require("./database/consts");
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const { whatis } = require("../util/langutil");
const { UserActorType } = require("./auth/Actor");

class ThreadService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    };

    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'service:thread');

        this.thread_body_max_size = 4 * 1024; // 4KiB
        
        const svc_apiError = this.services.get('api-error');
        svc_apiError.register({
            'thread_not_found': {
                status: 400,
                message: ({ uid }) => {
                    return `Thread with UID ${uid} was not found`;
                }
            },
        });

        const svc_permission = this.services.get('permission');
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'is-thread-owner',
            matcher: permission => {
                return permission.startsWith('thread:');
            },
            checker: async ({ actor, permission }) => {
                if ( !(actor.type instanceof UserActorType) ) {
                    return undefined;
                }

                const [_, uid] = PermissionUtil.split(permission);

                const thread = await this.get_thread({ uid });
                if (
                    thread.owner_user_id === actor.type.user.id &&
                    thread.parent_uid === null
                ) {
                    return {};
                }

                return undefined;
            }
        }));
        const NO_RECURSE_PERMISSIONS = ['children-of', 'own-children-of'];
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'children-of',
            matcher: permission => {
                if ( ! permission.startsWith('thread:') ) return;
                const [_, uid, ...rest] = PermissionUtil.split(permission);
                if ( rest.length > 0 && NO_RECURSE_PERMISSIONS.includes(rest[0]) ) {
                    return undefined;
                }
                return true;
            },
            checker: async ({ actor, permission }) => {
                const [_, uid, ...rest] = PermissionUtil.split(permission);

                const thread = await this.get_thread({ uid });
                const parent_uid = thread.parent_uid;
                if ( parent_uid === null ) {
                    return undefined;
                }

                const svc_permission = this.services.get('permission');
                const reading = await svc_permission.scan(
                    actor,
                    PermissionUtil.join('thread', parent_uid, 'children-of', ...rest),
                );
                const options = PermissionUtil.reading_to_options(reading);
                if ( options.length <= 0 ) {
                    return undefined;
                }

                return {};
            }
        }));
        svc_permission.register_implicator(PermissionImplicator.create({
            id: 'own-children-of',
            matcher: permission => {
                if ( ! permission.startsWith('thread:') ) return;
                const [_, uid, ...rest] = PermissionUtil.split(permission);
                debugger;
                if ( rest.length > 0 && NO_RECURSE_PERMISSIONS.includes(rest[0]) ) {
                    return undefined;
                }
                return true;
            },
            checker: async ({ actor, permission }) => {
                const [_, uid, ...rest] = PermissionUtil.split(permission);

                const thread = await this.get_thread({ uid });
                const parent_uid = thread.parent_uid;
                if ( parent_uid === null ) {
                    return undefined;
                }

                console.log('own children implicator', {
                    permission
                });

                if ( thread.owner_user_id !== actor.type.user.id ) {
                    return undefined;
                }

                const svc_permission = this.services.get('permission');
                const reading = await svc_permission.scan(
                    actor,
                    PermissionUtil.join('thread', parent_uid, 'own-children-of', ...rest),
                );
                const options = PermissionUtil.reading_to_options(reading);
                if ( options.length <= 0 ) {
                    return undefined;
                }

                return {};
            }
        }));

        await this.init_event_listeners_();
        await this.init_socket_subs_();
    }

    async init_event_listeners_() {
        const svc_event = this.services.get('event');
        svc_event.on('outer.thread.notify-subscribers', async (_, {
            uid, action, data,
        }) => {

            if ( ! this.socket_subs_[uid] ) return;

            const svc_socketio = this.services.get('socketio');
            await svc_socketio.send(
                Array.from(this.socket_subs_[uid]).map(socket => ({ socket })),
                'thread.' + action,
                { ...data, subscription: uid },
            );
        })
    }

    async init_socket_subs_ () {
        this.socket_subs_ = {};

        const svc_event = this.services.get('event');
        svc_event.on('web.socket.connected', async (_, { socket }) => {
            socket.on('disconnect', () => {
                for ( const uid in this.socket_subs_ ) {
                    this.socket_subs_[uid].delete(socket.id);
                }
            });

            socket.on('thread.sub-request', async ({ uid }) => {
                if ( ! this.socket_subs_[uid] ) {
                    this.socket_subs_[uid] = new Set();
                }

                this.socket_subs_[uid].add(socket.id);
            });

            socket.on('thread.sub-cancel', async ({ uid }) => {
                if ( this.socket_subs_[uid] ) {
                    this.socket_subs_[uid].delete(socket.id);
                }
            });
        });
    }

    async notify_subscribers (uid, action, data) {
        const svc_event = this.services.get('event');
        svc_event.emit('outer.thread.notify-subscribers', { uid, action, data });
    }

    async ['__on_install.routes'] (_, { app }) {
        const r_threads = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        })();
        app.use('/threads', r_threads);
        this.install_threads_endpoints_({ router: r_threads });
    }

    install_threads_endpoints_ ({ router }) {
        const svc_apiError = this.services.get('api-error');

        Endpoint({
            route: '/create',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const actor = Context.get('actor');

                const text = req.body.text;

                if ( whatis(text) !== 'string' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'text',
                        expected: 'string',
                        got: whatis(text),
                    });
                }
                if ( text.length > this.thread_body_max_size ) {
                    throw APIError.create('field_too_large', null, {
                        key: 'text',
                        max_size: this.thread_body_max_size,
                        size: text.length,
                    });
                }

                const uid = this.modules.uuidv4();

                const parent_uid = req.body.parent ?? null;
                if ( parent_uid !== null ) {
                    if ( whatis(parent_uid) !== 'string' ) {
                        throw APIError.create('field_invalid', null, {
                            key: 'parent',
                            expected: 'string',
                            got: whatis(parent_uid),
                        });
                    }

                    // Disable deep-nesting for now
                    {
                        const parent_thread = await this.get_thread({ uid: parent_uid });
                        if ( !parent_thread ) {
                            throw svc_apiError.create('thread_not_found', {
                                uid: parent_uid,
                            });
                        }

                        if ( parent_thread.parent_uid ) {
                            throw APIError.create('not_yet_supported', null, {
                                message: 'deeply nested threads are not yet supported',
                            });
                        }
                    }

                    const svc_permission = this.services.get('permission');
                    const reading = await svc_permission.scan(
                        actor,
                        PermissionUtil.join('thread', parent_uid, 'post'),
                    );
                    const options = PermissionUtil.reading_to_options(reading);
                    if ( options.length <= 0 ) {
                        throw APIError.create('permission_denied', null, {
                            permission: 'thread:' + parent_uid + ':post',
                        });
                    }
                }

                if ( parent_uid === null ) {
                    console.log('its this one');
                    await this.db.write(
                        "INSERT INTO `thread` (uid, owner_user_id, text) VALUES (?, ?, ?)",
                        [uid, actor.type.user.id, text]
                    );
                } else {
                    console.log('its tHAT one');
                    await this.db.write(
                        "INSERT INTO `thread` (uid, parent_uid, owner_user_id, text) VALUES (?, ?, ?, ?)",
                        [uid, parent_uid, actor.type.user.id, text]
                    );
                }

                res.json({ uid });

                // Notify subscribers
                await this.notify_subscribers(parent_uid, 'post', {
                    uid,
                    text,
                    user: {
                        username: actor.type.user.username,
                        uuid: actor.type.user.id,
                    },
                });
            }
        }).attach(router);

        Endpoint({
            route: '/edit/:uid',
            methods: ['PUT'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const text = req.body.text;

                if ( whatis(text) !== 'string' ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'text',
                        expected: 'string',
                        got: whatis(text),
                    });
                }
                if ( text.length > this.thread_body_max_size ) {
                    throw APIError.create('field_too_large', null, {
                        key: 'text',
                        max_size: this.thread_body_max_size,
                        size: text.length,
                    });
                }

                const uid = req.params.uid;

                if ( ! is_valid_uuid(uid) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'uid',
                        expected: 'uuid',
                        got: whatis(uid),
                    });
                }

                // Get existing thread
                const thread = await this.get_thread({ uid });
                if ( !thread ) {
                    throw svc_apiError.create('thread_not_found', {
                        uid,
                    });
                }
                const parent_uid = thread.parent_uid;

                const actor = Context.get('actor');

                // Check edit permission
                {
                    const permission = PermissionUtil.join('thread', uid, 'edit');
                    const svc_permission = this.services.get('permission');
                    const reading = await svc_permission.scan(actor, permission);
                    const options = PermissionUtil.reading_to_options(reading);
                    if ( options.length <= 0 ) {
                        throw APIError.create('permission_denied', null, {
                            permission,
                        });
                    }
                }

                // Update thread
                await this.db.write(
                    "UPDATE `thread` SET text=? WHERE uid=?",
                    [text, uid]
                );
                
                res.json({});

                // Notify subscribers
                await this.notify_subscribers(uid, 'edit', {
                    uid,
                    text,
                });

                // Notify parent subscribers
                await this.notify_subscribers(parent_uid, 'child-edit', {
                    uid,
                    text,
                });
            }
        }).attach(router);

        Endpoint({
            route: '/:uid',
            methods: ['DELETE'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const uid = req.params.uid;

                if ( ! is_valid_uuid(uid) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'uid',
                        expected: 'uuid',
                        got: whatis(uid),
                    });
                }

                // Get existing thread
                const thread = await this.get_thread({ uid });
                if ( !thread ) {
                    throw svc_apiError.create('thread_not_found', {
                        uid,
                    });
                }
                const parent_uid = thread.parent_uid;

                const actor = Context.get('actor');

                // Check edit permission
                {
                    const permission = PermissionUtil.join('thread', uid, 'delete');
                    const svc_permission = this.services.get('permission');
                    const reading = await svc_permission.scan(actor, permission);
                    const options = PermissionUtil.reading_to_options(reading);
                    if ( options.length <= 0 ) {
                        throw APIError.create('permission_denied', null, {
                            permission,
                        });
                    }
                }

                // Update thread
                await this.db.write(
                    "DELETE FROM `thread` WHERE uid=?",
                    [uid]
                );
                
                res.json({});

                // Notify subscribers
                await this.notify_subscribers(uid, 'delete', {
                    uid,
                });

                // Notify parent subscribers
                await this.notify_subscribers(parent_uid, 'child-delete', {
                    parent_uid,
                });
            }
        }).attach(router);

        Endpoint({
            route: '/read/:uid',
            methods: ['GET'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const uid = req.params.uid;

                if ( ! is_valid_uuid(uid) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'uid',
                        expected: 'uuid',
                        got: whatis(uid),
                    });
                }
                

                const actor = Context.get('actor');

                // Check read permission
                {
                    const permission = PermissionUtil.join('thread', uid, 'read');
                    const svc_permission = this.services.get('permission');
                    const reading = await svc_permission.scan(actor, permission);
                    const options = PermissionUtil.reading_to_options(reading);
                    if ( options.length <= 0 ) {
                        throw APIError.create('permission_denied', null, {
                            permission,
                        });
                    }
                }

                const thread = await this.get_thread({ uid });

                res.json(this.client_safe_thread(thread));
            }
        }).attach(router);

        Endpoint({
            route: '/list/:uid/:page',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const uid = req.params.uid;

                if ( ! is_valid_uuid(uid) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'uid',
                        expected: 'uuid',
                        got: whatis(uid),
                    });
                }

                const actor = Context.get('actor');

                // Check list permission
                {
                    const permission = PermissionUtil.join('thread', uid, 'list');
                    const svc_permission = this.services.get('permission');
                    const reading = await svc_permission.scan(actor, permission);
                    const options = PermissionUtil.reading_to_options(reading);
                    if ( options.length <= 0 ) {
                        throw APIError.create('permission_denied', null, {
                            permission,
                        });
                    }
                }

                const page = Number(req.params.page);
                const validate_positive_integer = (key, value) => {
                    if ( whatis(value) !== 'number' ) {
                        throw APIError.create('field_invalid', null, {
                            key,
                            expected: 'number',
                            got: whatis(value),
                        });
                    }
                    if ( value < 0 || ! Number.isInteger(value) ) {
                        throw APIError.create('field_invalid', null, {
                            key,
                            expected: 'positive integer',
                            got: value,
                        });
                    }
                }
                validate_positive_integer('page', page);

                if ( req.body.limit !== undefined ) {
                    validate_positive_integer('limit', req.body.limit);
                }

                const limit = Math.min(100, req.body.limit ?? 50);
                const offset = page * limit;

                const threads = await this.db.read(
                    "SELECT * FROM `thread` WHERE parent_uid=? LIMIT ?,?",
                    [uid, offset, limit]
                );

                res.json(await Promise.all(threads.map(
                    this.client_safe_thread.bind(this))));
            }
        }).attach(router);
    }

    async client_safe_thread (thread) {
        const svc_getUser = this.services.get('get-user');
        const user = await svc_getUser.get_user({ id: thread.owner_user_id });

        return {
            uid: thread.uid,
            parent: thread.parent_uid,
            text: thread.text,
            user: {
                username: user.username,
                uuid: user.uuid,
            },
        };
    }

    async get_thread ({ uid }) {
        const [thread] = await this.db.read(
            "SELECT * FROM `thread` WHERE uid=?",
            [uid]
        );

        if ( !thread ) {
            const svc_apiError = this.services.get('api-error');
            throw svc_apiError.create('thread_not_found', {
                uid,
            });
        }

        return thread;
    }
}

module.exports = {
    ThreadService,
};
