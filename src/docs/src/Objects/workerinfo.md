---
title: WorkerInfo
description: The WorkerInfo object containing worker information.
---

The `WorkerInfo` object containing worker information.

## Attributes

#### `name` (String)

A string containing the name of the worker.

#### `url` (String)

A string containing the URL of the worker.

#### `file_path` (String)

A string containing the file path of the worker source code.

#### `file_uid` (String)

A string containing the unique identifier of the worker file.

#### `app_uid` (String)

A string containing the unique identifier of the app the worker runs as, or `null` if the worker is user-scoped. A worker created without an app runs as its own `sandbox-<workerName>` app, and this is that app's ID. See [worker identity](/Workers/create/#worker-identity-and-shared-state).

#### `app_name` (String)

A string containing the name of the app the worker runs as, or `null` if the worker is user-scoped.

#### `created_at` (String)

A string containing the date and time when the worker was created.
