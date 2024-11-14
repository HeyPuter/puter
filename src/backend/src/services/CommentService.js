const APIError = require("../api/APIError");
const FSNodeParam = require("../api/filesystem/FSNodeParam");
const { get_user } = require("../helpers");
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

class CommentService extends BaseService {
    static MODULES = {
        uuidv4: require('uuid').v4,
    }
    _init () {
        const svc_database = this.services.get('database');
        this.db = svc_database.get(DB_WRITE, 'notification');
    }
    ['__on_install.routes'] (_, { app }) {
        const r_comment = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router()
        })();

        app.use('/comment', r_comment);

        Endpoint({
            route: '/comment',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const comment = await this.create_comment_({ req, res });

                if ( ! req.body.on ) {
                    throw APIError.create('field_missing', null, { key: 'on' });
                }

                const on_ = req.body.on;

                if ( on_.startsWith('fs:') ) {
                    const node = await (new FSNodeParam('path')).consolidate({
                        req,
                        getParam: () => on_.slice(3),
                    });

                    if ( req.body.version ) {
                        // this.attach_comment_to_fsentry_version({
                        //     node, comment, version,
                        // });
                        res.status(400).send('not implemented yet');
                        return;
                    } else {
                        this.attach_comment_to_fsentry({
                            node, comment,
                        });
                    }
                }

                res.json({
                    uid: comment.uid,
                });
            }
        }).attach(app);

        Endpoint({
            route: '/comment/list',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                if ( ! req.body.on ) {
                    throw APIError.create('field_missing', null, { key: 'on' });
                }

                const on_ = req.body.on;

                let comments;

                if ( on_.startsWith('fs:') ) {
                    const node = await (new FSNodeParam('path')).consolidate({
                        req,
                        getParam: () => on_.slice(3),
                    });

                    if ( req.body.version ) {
                        // this.attach_comment_to_fsentry_version({
                        //     node, comment, version,
                        // });
                        res.status(400).send('not implemented yet');
                        return;
                    } else {
                        comments = await this.get_comments_for_fsentry({
                            node,
                        });
                    }
                }

                const client_safe_comments = [];
                for ( const comment of comments ) {
                    client_safe_comments.push({
                        uid: comment.uid,
                        text: comment.text,
                        created: comment.created_at,
                        user: {
                            username: comment.user?.username,
                        },
                    });
                }

                res.json({
                    comments: client_safe_comments,
                });
            }
        }).attach(app);

    }

    async create_comment_ ({ req, res }) {
        if ( ! req.body.text ) {
            throw APIError.create('field_missing', null, { key: 'text' });
        }

        const text = req.body.text;

        const uuid = this.modules.uuidv4();

        const result = await this.db.write(
            'INSERT INTO `user_comments` ' +
            '(`uid`, `user_id`, `metadata`, `text`) ' +
            'VALUES (?, ?, ?, ?)',
            [uuid, req.user.id, '{}', text],
        );

        return {
            id: result.insertId,
            uid: uuid,
        };
    }

    async attach_comment_to_fsentry ({ node, comment })  {
        await this.db.write(
            'INSERT INTO `user_fsentry_comments` ' +
            '(`user_comment_id`, `fsentry_id`) ' +
            'VALUES (?, ?)',
            [comment.id, await node.get('mysql-id')],
        );
    }

    async get_comments_for_fsentry ({ node }) {
        const comments = await this.db.read(
            'SELECT * FROM `user_comments` ' +
            'JOIN `user_fsentry_comments` ' +
            'ON `user_comments`.`id` = `user_fsentry_comments`.`user_comment_id` ' +
            'WHERE `fsentry_id` = ?',
            [await node.get('mysql-id')],
        );

        for ( const comment of comments ) {
            const user_id = comment.user_id;
            const user = await get_user({ id: user_id });
            comment.user = user;
        }

        return comments;
    }
}

module.exports = { CommentService };
