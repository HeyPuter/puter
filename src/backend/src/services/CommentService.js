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

// METADATA // {"ai-commented":{"service":"claude"}}
const APIError = require("../api/APIError");
const FSNodeParam = require("../api/filesystem/FSNodeParam");
const { get_user } = require("../helpers");
const configurable_auth = require("../middleware/configurable_auth");
const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");


/**
* CommentService class handles all comment-related functionality in the system.
* Extends BaseService to provide comment creation, retrieval, and attachment capabilities
* for filesystem entries. Manages database operations for user comments and their
* associations with filesystem nodes. Provides REST API endpoints for comment
* operations including posting new comments and listing existing comments.
* @extends BaseService
*/
class CommentService extends BaseService {
    /**
    * Static module dependencies used by the CommentService class
    * @property {Function} uuidv4 - UUID v4 generator function from the uuid package
    */
    static MODULES = {
        uuidv4: require('uuid').v4,
    }
    _init () {
        const svc_database = this.services.get('database');
        this.db = svc_database.get(DB_WRITE, 'notification');
    }
    ['__on_install.routes'] (_, { app }) {
        /**
        * Installs route handlers for comment-related endpoints
        * Sets up POST routes for creating and listing comments on filesystem entries
        * 
        * @param {*} _ Unused parameter
        * @param {Object} options Installation options
        * @param {Express} options.app Express application instance
        * @private
        */
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


    /**
    * Creates a new comment with the given text
    * 
    * @param {Object} params - The parameters object
    * @param {Object} params.req - Express request object containing user and body data
    * @param {Object} params.res - Express response object
    * @returns {Promise<Object>} The created comment object with id and uid
    * @throws {APIError} If text field is missing from request body
    */
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


    /**
    * Attaches a comment to a filesystem entry
    * 
    * @param {Object} params - The parameters object
    * @param {Object} params.node - The filesystem node to attach the comment to
    * @param {Object} params.comment - The comment object containing id and other details
    * @returns {Promise<void>} Resolves when comment is successfully attached
    */
    async attach_comment_to_fsentry ({ node, comment })  {
        await this.db.write(
            'INSERT INTO `user_fsentry_comments` ' +
            '(`user_comment_id`, `fsentry_id`) ' +
            'VALUES (?, ?)',
            [comment.id, await node.get('mysql-id')],
        );
    }


    /**
    * Retrieves all comments associated with a filesystem entry
    * 
    * @param {Object} params - The parameters object
    * @param {Object} params.node - The filesystem node to get comments for
    * @returns {Promise<Array>} Array of comment objects with user info attached
    */
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
