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

const { spawn } = require("child_process");
const APIError = require("../../api/APIError");
const configurable_auth = require("../../middleware/configurable_auth");
const { Endpoint } = require("../../util/expressutil");


const PERM_LOCAL_TERMINAL = 'local-terminal:access';

const path_ = require('path');
const { Actor } = require("../../services/auth/Actor");
const BaseService = require("../../services/BaseService");
const { Context } = require("../../util/context");

class LocalTerminalService extends BaseService {
    _construct () {
        this.sessions_ = {};
    }
    get_profiles () {
        return {
            ['api-test']: {
                cwd: path_.join(
                    __dirname,
                    '../../../../../',
                    'tools/api-tester',
                ),
                shell: ['/usr/bin/env', 'node', 'apitest.js'],
                allow_args: true,
            },
        };
    };
    ['__on_install.routes'] (_, { app }) {
        const r_group = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router()
        })();
        app.use('/local-terminal', r_group);

        Endpoint({
            route: '/new',
            methods: ['POST'],
            mw: [configurable_auth()],
            handler: async (req, res) => {
                const term_uuid = require('uuid').v4();

                const svc_permission = this.services.get('permission');
                const actor = Context.get('actor');
                const can_access = actor &&
                    await svc_permission.check(actor, PERM_LOCAL_TERMINAL);
                
                if ( ! can_access ) {
                    throw APIError.create('permission_denied', null, {
                        permission: PERM_LOCAL_TERMINAL,
                    });
                }

                const profiles = this.get_profiles();
                if ( ! profiles[req.body.profile] ) {
                    throw APIError.create('invalid_profile', null, {
                        profile: req.body.profile,
                    });
                }

                const profile = profiles[req.body.profile];

                const args = profile.shell.slice(1);
                if ( ! profile.allow_args && req.body.args ) {
                    args.push(...req.body.args);
                }
                const proc = spawn(profile.shell[0], args, {
                    shell: true,
                    env: {
                        ...process.env,
                        ...(profile.env ?? {}),
                    },
                    cwd: profile.cwd,
                });

                console.log('process??', proc);

                // stdout to websocket
                {
                    const svc_socketio = req.services.get('socketio');
                    proc.stdout.on('data', data => {
                        const base64 = data.toString('base64');
                        console.log('---------------------- CHUNK?', base64);
                        svc_socketio.send(
                            { room: req.user.id },
                            'local-terminal.stdout',
                            {
                                term_uuid,
                                base64,
                            },
                        );
                    });
                    proc.stderr.on('data', data => {
                        const base64 = data.toString('base64');
                        console.log('---------------------- CHUNK?', base64);
                        svc_socketio.send(
                            { room: req.user.id },
                            'local-terminal.stderr',
                            {
                                term_uuid,
                                base64,
                            },
                        );
                    });
                }
                
                proc.on('exit', () => {
                    this.log.noticeme(`[${term_uuid}] Process exited (${proc.exitCode})`);
                    delete this.sessions_[term_uuid];
                });

                this.sessions_[term_uuid] = {
                    uuid: term_uuid,
                    proc,
                };

                res.json({ term_uuid });
            },
        }).attach(r_group);
    }
    async _init () {
        const svc_event = this.services.get('event');
        svc_event.on('web.socket.user-connected', async (_, {
            socket,
            user,
        }) => {
            const svc_permission = this.services.get('permission');
            const actor = Actor.adapt(user);
            const can_access = actor &&
                await svc_permission.check(actor, PERM_LOCAL_TERMINAL);

            if ( ! can_access ) {
                return;
            }

            socket.on('local-terminal.stdin', async msg => {
                console.log('local term message', msg);

                const session = this.sessions_[msg.term_uuid];
                if ( ! session ) {
                    return;
                }

                const base64 = Buffer.from(msg.data, 'base64');
                session.proc.stdin.write(base64);
            })
        });
    }
}

module.exports = LocalTerminalService;
