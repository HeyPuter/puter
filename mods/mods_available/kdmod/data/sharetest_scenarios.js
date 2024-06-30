module.exports = [
    {
        sequence: [
            {
                title: 'Kyle creates a file',
                call: 'create-example-file',
                as: 'testuser_kyle',
                with: {
                    name: 'example.txt',
                    contents: 'secret file',
                }
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-no-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_kyle/Desktop/example.txt'
                }
            },
        ]
    },
    {
        sequence: [
            {
                title: 'Stan creates a file',
                call: 'create-example-file',
                as: 'testuser_stan',
                with: {
                    name: 'example.txt',
                    contents: 'secret file',
                }
            },
            {
                title: 'Stan grants permission to Eric',
                call: 'grant',
                as: 'testuser_stan',
                with: {
                    to: 'testuser_eric',
                    permission: 'fs:/testuser_stan/Desktop/example.txt:read'
                }
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_stan/Desktop/example.txt',
                    level: 'read'
                }
            },
        ]
    },
    {
        sequence: [
            {
                title: 'Stan grants Kyle\'s file to Eric',
                call: 'grant',
                as: 'testuser_stan',
                with: {
                    to: 'testuser_eric',
                    permission: 'fs:/testuser_kyle/Desktop/example.txt:read'
                }
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-no-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_kyle/Desktop/example.txt',
                }
            },
        ]
    },
];
