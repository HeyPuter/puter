module.exports = [
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
                ]
            },
            allow: {
                type: 'boolean',
                mutability: 'mutable',
                summary: 'whether the email is allowed',
                notes: [
                    'If set to false, the email will be considered invalid.',
                ]
            },
        },
    }
];