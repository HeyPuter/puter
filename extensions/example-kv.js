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
