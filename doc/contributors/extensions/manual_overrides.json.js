export default [
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
                    'The email may have already been cleaned.',
                ],
            },
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the email is allowed',
                notes: [
                    'If set to false, the email will be considered invalid.',
                ],
            },
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

                    console.log('\\x1B[36;1m === MEASUREMENT ===\\x1B[0m\\n', {
                        actor: data.actor.uid,
                        measurements: data.measurements
                    });
                });
            `,
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
                summary: 'the directory that was created',
            },
            context: {
                type: 'Context',
                mutability: 'no-effect',
                summary: 'current context',
            },
        },
    },
];