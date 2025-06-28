export default [
    {
        id: 'ai.prompt.check-usage',
        description: `
            This event is emitted for ai prompt check usage operations.
        `,
        properties: {
            completionId: {
                type: 'any',
                mutability: 'mutable',
                summary: 'completionId',
                notes: [],
            },
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
        id: 'ai.prompt.complete',
        description: `
            This event is emitted for ai prompt complete operations.
        `,
        properties: {
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
        id: 'ai.prompt.cost-calculated',
        description: `
            This event is emitted for ai prompt cost calculated operations.
        `,
    },
    {
        id: 'ai.prompt.report-usage',
        description: `
            This event is emitted for ai prompt report usage operations.
        `,
    },
    {
        id: 'ai.prompt.validate',
        description: `
            This event is emitted when a validate is being validated.
            The event can be used to block certain validates from being validated.
        `,
        properties: {
            completionId: {
                type: 'any',
                mutability: 'mutable',
                summary: 'completionId',
                notes: [],
            },
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
        id: 'app.new-icon',
        description: `
            This event is emitted for app new icon operations.
        `,
        properties: {
            data_url: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'data url',
                notes: [],
            }
        },
    },
    {
        id: 'app.rename',
        description: `
            This event is emitted for app rename operations.
        `,
        properties: {
            data_url: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'data url',
                notes: [],
            }
        },
    },
    {
        id: 'apps.invalidate',
        description: `
            This event is emitted when a invalidate is being validated.
            The event can be used to block certain invalidates from being validated.
        `,
        properties: {
            apps: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'apps',
                notes: [],
            }
        },
    },
    {
        id: 'captcha.check',
        description: `
            This event is emitted for captcha check operations.
        `,
        properties: {
            required: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'required',
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
        id: 'credit.check-available',
        description: `
            This event is emitted for credit check available operations.
        `,
        properties: {
            available: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'available',
                notes: [],
            },
            cost_uuid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'cost uuid',
                notes: [],
            }
        },
    },
    {
        id: 'credit.funding-update',
        description: `
            This event is emitted when a funding-update is updated.
        `,
        properties: {
            available: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'available',
                notes: [],
            },
            cost_uuid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'cost uuid',
                notes: [],
            }
        },
    },
    {
        id: 'credit.record-cost',
        description: `
            This event is emitted for credit record cost operations.
        `,
        properties: {
            available: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'available',
                notes: [],
            },
            cost_uuid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'cost uuid',
                notes: [],
            }
        },
    },
    {
        id: 'driver.create-call-context',
        description: `
            This event is emitted when a create-call-context is created.
        `,
        properties: {
            usages: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'usages',
                notes: [],
            }
        },
    },
    {
        id: 'email.validate',
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
                    'If set to false, the email will be considered invalid.',
                ],
            },
            email: {
                type: 'any',
                mutability: 'mutable',
                summary: 'email',
                notes: [
                    'The email may have already been cleaned.',
                ],
            }
        },
    },
    {
        id: 'fs.create.directory',
        description: `
            This event is emitted when a directory is created.
        `,
    },
    {
        id: 'fs.create.file',
        description: `
            This event is emitted when a file is created.
        `,
        properties: {
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            }
        },
    },
    {
        id: 'fs.create.shortcut',
        description: `
            This event is emitted when a shortcut is created.
        `,
    },
    {
        id: 'fs.create.symlink',
        description: `
            This event is emitted when a symlink is created.
        `,
    },
    {
        id: 'fs.move.file',
        description: `
            This event is emitted for fs move file operations.
        `,
        properties: {
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
        id: 'fs.pending.file',
        description: `
            This event is emitted for fs pending file operations.
        `,
    },
    {
        id: 'fs.storage.progress.copy',
        description: `
            This event reports progress of a copy operation.
        `,
        properties: {
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
        id: 'fs.storage.upload-progress',
        description: `
            This event reports progress of a upload-progress operation.
        `,
    },
    {
        id: 'fs.write.file',
        description: `
            This event is emitted when a file is updated.
        `,
        properties: {
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
                notes: [],
            }
        },
    },
    {
        id: 'ip.validate',
        description: `
            This event is emitted when a validate is being validated.
            The event can be used to block certain validates from being validated.
        `,
        properties: {
            res: {
                type: 'any',
                mutability: 'mutable',
                summary: 'res',
                notes: [],
            },
            end_: {
                type: 'any',
                mutability: 'mutable',
                summary: 'end ',
                notes: [],
            },
            end: {
                type: 'any',
                mutability: 'mutable',
                summary: 'end',
                notes: [],
            }
        },
    },
    {
        id: 'outer.fs.write-hash',
        description: `
            This event is emitted when a write-hash is updated.
        `,
        properties: {
            uuid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'uuid',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.item.added',
        description: `
            This event is emitted for outer gui item added operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.item.moved',
        description: `
            This event is emitted for outer gui item moved operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.item.pending',
        description: `
            This event is emitted for outer gui item pending operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.item.updated',
        description: `
            This event is emitted when a updated is updated.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.notif.ack',
        description: `
            This event is emitted for outer gui notif ack operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.notif.message',
        description: `
            This event is emitted for outer gui notif message operations.
        `,
        properties: {
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
        id: 'outer.gui.notif.persisted',
        description: `
            This event is emitted for outer gui notif persisted operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.notif.unreads',
        description: `
            This event is emitted for outer gui notif unreads operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.submission.done',
        description: `
            This event is emitted for outer gui submission done operations.
        `,
        properties: {
            response: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'response',
                notes: [],
            }
        },
    },
    {
        id: 'outer.gui.usage.update',
        description: `
            This event is emitted when a update is updated.
        `,
    },
    {
        id: 'outer.thread.notify-subscribers',
        description: `
            This event is emitted for outer thread notify subscribers operations.
        `,
        properties: {
            uid: {
                type: 'string',
                mutability: 'no-effect',
                summary: 'uid',
                notes: [],
            },
            action: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'action',
                notes: [],
            },
            data: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'data',
                notes: [],
            }
        },
    },
    {
        id: 'puter.signup',
        description: `
            This event is emitted for puter signup operations.
        `,
        properties: {
            ip: {
                type: 'any',
                mutability: 'mutable',
                summary: 'ip',
                notes: [],
            },
            user_agent: {
                type: 'any',
                mutability: 'mutable',
                summary: 'user agent',
                notes: [],
            },
            body: {
                type: 'any',
                mutability: 'mutable',
                summary: 'body',
                notes: [],
            }
        },
    },
    {
        id: 'request.measured',
        description: `
            This event is emitted for request measured operations.
        `,
        properties: {
            req: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'req',
                notes: [],
            },
            res: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'res',
                notes: [],
            }
        },
    },
    {
        id: 'request.will-be-handled',
        description: `
            This event is emitted for request will be handled operations.
        `,
        properties: {
            res: {
                type: 'any',
                mutability: 'mutable',
                summary: 'res',
                notes: [],
            },
            end_: {
                type: 'any',
                mutability: 'mutable',
                summary: 'end ',
                notes: [],
            },
            end: {
                type: 'any',
                mutability: 'mutable',
                summary: 'end',
                notes: [],
            }
        },
    },
    {
        id: 'sns',
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
        id: 'template-service.hello',
        description: `
            This event is emitted for template-service hello operations.
        `,
    },
    {
        id: 'usages.query',
        description: `
            This event is emitted for usages query operations.
        `,
        properties: {
            usages: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'usages',
                notes: [],
            }
        },
    },
    {
        id: 'user.email-changed',
        description: `
            This event is emitted for user email changed operations.
        `,
        properties: {
            new_email: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'new email',
                notes: [],
            }
        },
    },
    {
        id: 'user.email-confirmed',
        description: `
            This event is emitted for user email confirmed operations.
        `,
        properties: {
            email: {
                type: 'any',
                mutability: 'no-effect',
                summary: 'email',
                notes: [],
            }
        },
    },
    {
        id: 'user.save_account',
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
        id: 'web.socket.connected',
        description: `
            This event is emitted for web socket connected operations.
        `,
        properties: {
            user: {
                type: 'User',
                mutability: 'mutable',
                summary: 'user associated with the operation',
                notes: [],
            }
        },
    },
    {
        id: 'web.socket.user-connected',
        description: `
            This event is emitted for web socket user connected operations.
        `,
        properties: {
            user: {
                type: 'User',
                mutability: 'mutable',
                summary: 'user associated with the operation',
                notes: [],
            }
        },
    },
    {
        id: 'wisp.get-policy',
        description: `
            This event is emitted for wisp get policy operations.
        `,
        properties: {
            policy: {
                type: 'Policy',
                mutability: 'mutable',
                summary: 'policy information for the operation',
                notes: [],
            }
        },
    }
];
