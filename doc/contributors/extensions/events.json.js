export default [
    {
        id: 'core.ai.prompt.check-usage',
        description: `
            This event is emitted for ai prompt check usage operations.
        `,
        properties: {
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the operation is allowed',
                notes: [],
            },
            intended_service: {
                type: 'any',
                mutability: 'mutable',
                summary: 'intended service',
                notes: [],
            },
            parameters: {
                type: 'any',
                mutability: 'mutable',
                summary: 'parameters',
                notes: [],
            }
        },
    },
    {
        id: 'core.ai.prompt.complete',
        description: `
            This event is emitted for ai prompt complete operations.
        `,
        properties: {
            username: {
                type: 'string',
                mutability: 'mutable',
                summary: 'username',
                notes: [],
            },
            intended_service: {
                type: 'any',
                mutability: 'mutable',
                summary: 'intended service',
                notes: [],
            },
            parameters: {
                type: 'any',
                mutability: 'mutable',
                summary: 'parameters',
                notes: [],
            },
            result: {
                type: 'any',
                mutability: 'mutable',
                summary: 'result',
                notes: [],
            },
            model_used: {
                type: 'any',
                mutability: 'mutable',
                summary: 'model used',
                notes: [],
            },
            service_used: {
                type: 'any',
                mutability: 'mutable',
                summary: 'service used',
                notes: [],
            }
        },
    },
    {
        id: 'core.ai.prompt.report-usage',
        description: `
            This event is emitted for ai prompt report usage operations.
        `,
    },
    {
        id: 'core.ai.prompt.validate',
        description: `
            This event is emitted when a validate is being validated.
            The event can be used to block certain validates from being validated.
        `,
        properties: {
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the operation is allowed',
                notes: [
                    'If set to false, the ai will be considered invalid.',
                ],
            },
            intended_service: {
                type: 'any',
                mutability: 'mutable',
                summary: 'intended service',
                notes: [],
            },
            parameters: {
                type: 'any',
                mutability: 'mutable',
                summary: 'parameters',
                notes: [],
            }
        },
    },
    {
        id: 'core.app.new-icon',
        description: `
            This event is emitted for app new icon operations.
        `,
        properties: {
            app_uid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'app uid',
                notes: [],
            },
            data_url: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'data url',
                notes: [],
            }
        },
    },
    {
        id: 'core.app.rename',
        description: `
            This event is emitted for app rename operations.
        `,
        properties: {
            app_uid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'app uid',
                notes: [],
            },
            data_url: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'data url',
                notes: [],
            }
        },
    },
    {
        id: 'core.apps.invalidate',
        description: `
            This event is emitted when a invalidate is being validated.
            The event can be used to block certain invalidates from being validated.
        `,
        properties: {
            options: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'options',
                notes: [],
            },
            apps: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'apps',
                notes: [],
            }
        },
    },
    {
        id: 'core.email.validate',
        description: `
            This event is emitted when an email is being validated.
            The event can be used to block certain emails from being validated.
        `,
        properties: {
            email: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'the email being validated',
                notes: [
                    'The email may have already been cleaned.'
                ]
            },
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the email is allowed',
                notes: [
                    'If set to false, the email will be considered invalid.'
                ]
            }
        },
    },
    {
        id: 'core.fs.create.directory',
        description: `
            This event is emitted when a directory is created.
        `,
        properties: {
            node: {
                type: 'FSNodeContext',
                mutability: 'no-effect',
                summary: 'the directory that was created'
            },
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context'
            }
        },
    },
    {
        id: 'core.fs.create.file',
        description: `
            This event is emitted when a file is created.
        `,
        properties: {
            node: {
                type: 'FSNodeContext',
                mutability: 'no-effect',
                summary: 'the file that was affected',
                notes: [],
            },
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            }
        },
    },
    {
        id: 'core.fs.create.shortcut',
        description: `
            This event is emitted when a shortcut is created.
        `,
    },
    {
        id: 'core.fs.create.symlink',
        description: `
            This event is emitted when a symlink is created.
        `,
    },
    {
        id: 'core.fs.move.file',
        description: `
            This event is emitted for fs move file operations.
        `,
        properties: {
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            },
            moved: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'moved',
                notes: [],
            },
            old_path: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'path to the affected resource',
                notes: [],
            }
        },
    },
    {
        id: 'core.fs.pending.file',
        description: `
            This event is emitted for fs pending file operations.
        `,
    },
    {
        id: 'core.fs.storage.progress.copy',
        description: `
            This event reports progress of a copy operation.
        `,
        properties: {
            upload_tracker: {
                type: 'ProgressTracker',
                mutability: 'no-effect',
                summary: 'tracks progress of the operation',
                notes: [],
            },
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            },
            meta: {
                type: 'object',
                mutability: 'no-effect',
                summary: 'additional metadata for the operation',
                notes: [],
            },
            item_path: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'path to the affected resource',
                notes: [],
            }
        },
    },
    {
        id: 'core.fs.storage.upload-progress',
        description: `
            This event reports progress of a upload-progress operation.
        `,
    },
    {
        id: 'core.fs.write.file',
        description: `
            This event is emitted when a file is updated.
        `,
        properties: {
            node: {
                type: 'FSNodeContext',
                mutability: 'no-effect',
                summary: 'the file that was affected',
                notes: [],
            },
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            }
        },
    },
    {
        id: 'core.ip.validate',
        description: `
            This event is emitted when a validate is being validated.
            The event can be used to block certain validates from being validated.
        `,
        properties: {
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the operation is allowed',
                notes: [
                    'If set to false, the ip will be considered invalid.',
                ],
            },
            ip: {
                type: 'any',
                mutability: 'mutable',
                summary: 'ip',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.fs.write-hash',
        description: `
            This event is emitted when a write-hash is updated.
        `,
        properties: {
            hash: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'hash',
                notes: [],
            },
            uuid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'uuid',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.item.added',
        description: `
            This event is emitted for outer gui item added operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.item.moved',
        description: `
            This event is emitted for outer gui item moved operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.item.pending',
        description: `
            This event is emitted for outer gui item pending operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.item.updated',
        description: `
            This event is emitted when a updated is updated.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.notif.ack',
        description: `
            This event is emitted for outer gui notif ack operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.notif.message',
        description: `
            This event is emitted for outer gui notif message operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            },
            notification: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'notification',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.notif.persisted',
        description: `
            This event is emitted for outer gui notif persisted operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.notif.unreads',
        description: `
            This event is emitted for outer gui notif unreads operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.outer.gui.submission.done',
        description: `
            This event is emitted for outer gui submission done operations.
        `,
        properties: {
            user_id_list: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id list',
                notes: [],
            },
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'core.puter-exec.submission.done',
        description: `
            This event is emitted for puter-exec submission done operations.
        `,
    },
    {
        id: 'core.request.measured',
        description: `
            This event is emitted when a requests incoming and outgoing bytes
            have been measured.
        `,
        example: {
            language: 'javascript',
            code: /*javascript*/`
                extension.on('core.request.measured', data => {
                    const measurements = data.measurements;
                    //    measurements = { sz_incoming: integer, sz_outgoing: integer }

                    const actor = data.actor; // instance of Actor

                    console.log('\x1B[36;1m === MEASUREMENT ===\x1B[0m\n', {
                        actor: data.actor.uid,
                        measurements: data.measurements
                    });
                });
            `
        },
    },
    {
        id: 'core.sns',
        description: `
            This event is emitted for sns operations.
        `,
        properties: {
            message: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'message',
                notes: [],
            }
        },
    },
    {
        id: 'core.template-service.hello',
        description: `
            This event is emitted for template-service hello operations.
        `,
        properties: {
            message: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'message',
                notes: [],
            }
        },
    },
    {
        id: 'core.usages.query',
        description: `
            This event is emitted for usages query operations.
        `,
        properties: {
            actor: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'actor',
                notes: [],
            },
            usages: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'usages',
                notes: [],
            }
        },
    },
    {
        id: 'core.user.email-changed',
        description: `
            This event is emitted for user email changed operations.
        `,
        properties: {
            user_id: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user id',
                notes: [],
            },
            new_email: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'new email',
                notes: [],
            }
        },
    },
    {
        id: 'core.user.email-confirmed',
        description: `
            This event is emitted for user email confirmed operations.
        `,
        properties: {
            user_uid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'user uid',
                notes: [],
            },
            email: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'email',
                notes: [],
            }
        },
    },
    {
        id: 'core.user.save_account',
        description: `
            This event is emitted for user save_account operations.
        `,
        properties: {
            user: {
                type: 'User',
                mutability: 'no-effect',
                summary: 'user associated with the operation',
                notes: [],
            }
        },
    },
    {
        id: 'core.web.socket.connected',
        description: `
            This event is emitted for web socket connected operations.
        `,
        properties: {
            socket: {
                type: 'any',
                mutability: 'mutable',
                summary: 'socket',
                notes: [],
            },
            user: {
                type: 'User',
                mutability: 'mutable',
                summary: 'user associated with the operation',
                notes: [],
            }
        },
    },
    {
        id: 'core.web.socket.user-connected',
        description: `
            This event is emitted for web socket user connected operations.
        `,
        properties: {
            socket: {
                type: 'any',
                mutability: 'mutable',
                summary: 'socket',
                notes: [],
            },
            user: {
                type: 'User',
                mutability: 'mutable',
                summary: 'user associated with the operation',
                notes: [],
            }
        },
    },
    {
        id: 'core.wisp.get-policy',
        description: `
            This event is emitted for wisp get policy operations.
        `,
        properties: {
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the operation is allowed',
                notes: [],
            },
            policy: {
                type: 'Policy',
                mutability: 'mutable',
                summary: 'policy information for the operation',
                notes: [],
            }
        },
    }
];
