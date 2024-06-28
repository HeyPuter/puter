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
    }
];
