---
title: DetailedAppUsage
description: Object containing detailed resource usage statistics for a specific application.
---

Object containing detailed resource usage statistics for a specific application.

## Attributes

#### `total` (Number)

The application's total resource consumption.

#### `[apiName]` (Object)

Usage information per API. Each key is an API name, and the value is an object with:

- `cost` (Number) - Total resource consumed by this API.
- `count` (Number) - Number of times the API is called.
- `units` (Number) - Units of measurement for each API (e.g., tokens for AI calls, bytes for FS operations, etc).

<div class="info">

Resources in Puter are measured in microcents (e.g., $0.50 = 50,000,000).

</div>
