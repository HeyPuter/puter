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

Resources in Puter are measured in microcents (e.g., $0.01 = 1,000,000).

</div>

<div class="info">

`total` is always current. The per-API breakdown can lag up to about a
minute behind it. Once a month has used more than 5,000 distinct APIs, the
rest are grouped under an `other` entry rather than listed individually.

</div>
