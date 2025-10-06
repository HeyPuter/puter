Creates and deploys a new worker from a JavaScript file containing [router](../router) code.

<div class="info">To create a worker, you'll need a <a href="https://puter.com/">Puter account</a> with a verified email address.</div>

<div class="info">After a worker is created or updated, full propagation may take between 5 to 30 seconds to fully take effect across all edge servers. </div>



## Syntax

```js
puter.workers.create(workerName, filePath)
```

## Parameters

#### `workerName` (String)(Required)
The name for the worker. It can contain letters, numbers, hyphens, and underscores.

#### `filePath` (String)(Required)
The path to a JavaScript file in your Puter account that contains your [router](../router) code.

<div class="info">Workers cannot be larger than <strong>10MB</strong>.</div>

## Return Value

A `Promise` that resolves to an object on success:

```js
{
    success: true,
    url: "https://worker-name.puter.work",
    errors: []
}
```

On failure, throws an `Error` with the reason.

## Examples

<strong class="example-title">Basic Syntax</strong>

```js
// Create a new worker from a file in your Puter account
puter.workers.create('my-api', 'api-server.js')
    .then(result => {
        console.log(`Worker deployed at: ${result.url}`);
    })
    .catch(error => {
        console.error('Deployment failed:', error.message);
    });
```

<strong class="example-title">Complete Example</strong>

```html;workers-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // 1. Create a worker file in your Puter account.
        puter.print('→ Writing the worker code to my-worker.js<br>');
        const workerCode = `
        // A router for /api/hello
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
```