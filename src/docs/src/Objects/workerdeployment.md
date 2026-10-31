---
title: WorkerDeployment
description: The WorkerDeployment object containing worker deployment result data.
---

The `WorkerDeployment` object containing worker deployment result data.

## Attributes

#### `success` (Boolean)

A boolean value indicating whether the worker deployment was successful.

#### `url` (String)

A string containing the URL of the deployed worker.

#### `errors` (Array)

An array containing any errors that occurred during deployment.

#### `app_uid` (String)

A string containing the unique identifier of the app the worker runs as, or `null` if the worker is user-scoped. See [worker identity](/Workers/create/#worker-identity-and-shared-state).

#### `app_name` (String)

A string containing the name of the app the worker runs as, or `null` if the worker is user-scoped.
