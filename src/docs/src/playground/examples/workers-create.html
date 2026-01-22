<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // 1. Create a worker file in your Puter account.
        puter.print('→ Writing the worker code to my-worker.js<br>');
        const workerCode = `
        // API routes
        router.get('/api/hello', async (event) => {
            return 'Hello from worker!';
        });
        `;

        // Save the worker code to my-worker.js in your Puter account
        await puter.fs.write('my-worker.js', workerCode);

        // 2. Deploy the worker using the file path
        const workerName = puter.randName();
        puter.print(`→ Deploying ${workerName} worker. May take up to 10 seconds to deploy.<br>`);
        const deployment = await puter.workers.create(workerName, 'my-worker.js');
        
        // 3. Test the worker
        puter.print(`→ Wait 5 seconds before testing the worker to make sure it's propagated.<br>`);

        setTimeout(async ()=>{
            const response = await fetch(`${deployment.url}/api/hello`);
            puter.print('→ Test response: ', await response.text());
        }, 5000);
    })();
    </script>
</body>
</html>
