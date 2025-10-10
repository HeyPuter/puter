const { kv } = extension.import('data');
const { sleep } = extension.import('utilities');

// "kv" is load ready to use before the 'init' event is fired.
extension.on('init', async () => {
    kv.set('example-kv-key', 'example-kv-value');

    console.log('kv key has', await kv.get('example-kv-key'));

    await kv.expire({
        key: 'example-kv-key',
        ttl: 1000 * 60, // 1 minute
    });

    // This AIIFE demonstrates how "kv.expire" works.
    // We cannot simply "await" this - otherwise we block init!
    (async () => {
        // wait for 30 seconds...
        await sleep(30 * 1000);

        console.log('kv key still has value', await kv.get('example-kv-key'));

        // wait for 30 more seconds
        await sleep(30 * 1000);
        // and just a little bit longer
        // await sleep(100);

        console.log('kv key should no longer have the value', kv.get('example-kv-key'));
    })();
});

// "kv" is always loaded by the time request handlers are active
extension.get('/example-kv', { noauth: true }, async (req, res) => {
    // if ( ! req.actor ) {
    //     res.status(403).send('You need to be logged in to use kv!');
    //     return;
    // }

    // Puter has a convenient service called `su` that lets us change the user.
    // We need to specify "sudo" (running as system user) because this is a
    // request handler and we disabled authentication to make this example page
    // a little easier to access.
    //
    // If we did not use "sudo" here, you could still `fetch` this URL from
    // inside an authenticated Puter session, but it wouldn't work otherwise.
    //
    const su = extension.import('service:su');
    await su.sudo(async () => {
        res.set('Content-Type', 'text/plain'); // don't treat output as HTML
        res.send(`kv value is: ${await kv.get('example-kv-key')}`);
    });
});
