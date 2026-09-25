---
title: MonthlyUsage
description: Object containing user's monthly resource usage information in the Puter ecosystem.
---

Object containing user's monthly resource usage information in the Puter ecosystem.

## Attributes

#### `allowanceInfo` (Object)

Information about the user's resource allowance and consumption.

- `monthUsageAllowance` (Number) - Total resource allowance for the month.
- `remaining` (Number) - The remaining allowance that can be used.

#### `appTotals` (Object)

Total usage by application. Each key is an application id, and the value is an object with:

- `count` (Number) - Number of Puter API calls per application.
- `total` (Number) - Total resources consumed per application.

#### `usage` (Object)

Usage information per API. Each key is an API name, and the value is an object with:

- `cost` (Number) - Total resource consumed by this API.
- `count` (Number) - Number of times the API is called.
- `units` (Number) - Units of measurement for each API (e.g., tokens for AI calls, bytes for FS operations, etc).

<div class="info">

Resources in Puter are measured in microcents (e.g., $0.01 = 1,000,000).

</div>

<div class="info">

`allowanceInfo` and the total resources consumed are always current. The
per-API breakdown under `usage` and the per-app breakdown under `appTotals`
can each lag up to about a minute behind it. Once a month has used more than
5,000 distinct APIs, the rest are grouped under an `other` entry rather than
listed individually.

</div>
