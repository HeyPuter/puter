Serverless Workers are serverless functions that run JavaScript code in the cloud. They use a router-based system to handle HTTP requests and can integrate with Puter's cloud services like file storage, key-value databases, and AI APIs. Workers are perfect for building REST APIs, webhooks, data processing pipelines, and backend services.


The Workers API allows you to create, manage, and execute workers.

## Available Functions

- **[`puter.workers.create()`](/Workers/create/)** - Create a new worker
- **[`puter.workers.delete()`](/Workers/delete/)** - Delete a worker
- **[`puter.workers.list()`](/Workers/list/)** - List all workers
- **[`puter.workers.get()`](/Workers/get/)** - Get information about a specific worker
- **[`puter.workers.exec()`](/Workers/exec/)** - Execute a worker
- **[`router`](/Workers/router/)** - The router object for handling HTTP requests