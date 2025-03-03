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
                            throw APIError.create('thread_not_found', null, {
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
                console.log('thread???', thread);
                if ( !thread ) {
                    throw APIError.create('thread_not_found', null, {
                        uid,
                    });
                }

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
            }
        }).attach(router);

        Endpoint({
            route: '/delete/:uid',
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
                    throw APIError.create('thread_not_found', null, {
                        uid,
                    });
                }

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

                res.json(threads.map(this.client_safe_thread));
            }
        }).attach(router);
    }

    client_safe_thread (thread) {
        return {
            uid: thread.uid,
            parent: thread.parent_uid,
            text: thread.text,
        };
    }

    async get_thread ({ uid }) {
        const [thread] = await this.db.read(
            "SELECT * FROM `thread` WHERE uid=?",
            [uid]
        );

        if ( !thread ) {
            throw APIError.create('thread_not_found', null, {
                uid,
            });
        }

        return thread;
    }
}

module.exports = {
    ThreadService,
};
