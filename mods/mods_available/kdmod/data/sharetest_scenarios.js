module.exports = [
    {
        title: `Kyle creates a file; Eric tries access read it`,
        sequence: [
            {
                call: 'create-example-file',
                as: 'testuser_kyle',
                with: {
                    name: 'example.txt',
                    contents: 'secret file',
                }
            },
            {
                call: 'assert-no-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_kyle/Desktop/example.txt'
                }
            },
        ]
    }
];
