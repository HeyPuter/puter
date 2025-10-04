Gets the information for a specific worker.

## Syntax

```js
puter.workers.get(workerName)
```

## Parameters

#### `workerName` (String)(Required)
The name of the worker to get the information for.

## Return Value

A `Promise` that resolves to the worker's information as an object.

## Examples

<strong class="example-title">Basic Usage</strong>

```js
// Get a worker's information
try {
    const workerInfo = await puter.workers.get('my-api');
    console.log(`Worker information: ${JSON.stringify(workerInfo, null, 2)}`);
} catch (error) {
    console.error('Worker not found:', error.message);
}
```