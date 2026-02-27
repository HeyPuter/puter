// "I know Kung-Fu...." - Neo, 1999

// This file doesn't work yet. When it does, this comment will be removed.

const { init, log, web } = world;

init(async () => {
    log.info("I am hello.js in the neo-module");
});

web.get('/new-endpoint', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>New Endpoint</title>
            </head>
            <body>
                The page you are currently viewing comes from
                the <code>hello.js</code> file in a Puter backend
                module called "neomodule". This module isn't necessary
                for Puter to function; it exists so that new contributors
                to Puter's backend can look its code as a reference for
                the current "right way" to build new features for Puter.
            </body>
        </html>
    `);
});
