extension.get('/example-onefile-get', (req, res) => {
    res.send('Hello World!');
});

extension.on('install', ({ services }) => {
    console.log('install was called');
})
