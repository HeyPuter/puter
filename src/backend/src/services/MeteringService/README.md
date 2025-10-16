# Metering and Billing Service

This service provides all metering functionality in puter. It relies on our own KV infrastructure to track usage (note the implementation of kvStore affects performance, and atomicity, currently sqlite implementation is not atomic).

It will also slowly add billing functionlity in it and through extension events.

## Cost maps
The metering service relies on cost maps to determine how much to charge for a given operation. Cost maps are simple JSON objects that map a usage type to a cost per unit in microcents (1 millionth of a cent).
For example, a cost map for AWS Polly might look like this:

```json
{
    "aws-polly:standard:character": 4,
    "aws-polly:neural:character": 16
}
```

We need to manually update these for now until we can automate it somehow.

## Usage and allowance tracking
This service provides functionality to directly check if a user has enough credits to perform an operation, and to record usage after the operation is complete.
See [MeteringService.ts](./MeteringService.ts) for more details on how metering works.
This should be the primary, and ideally only, way to check for usage and record it.