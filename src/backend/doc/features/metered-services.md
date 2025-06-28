# Metered Services and Cost Management

Puter supports metered services through the CostService infrastructure. This allows services to check available funds, record costs, and track usage in a standardized way.

## CostService Overview

The CostService (`src/backend/src/services/drivers/CostService.js`) provides core functionality for managing costs and funds:

```javascript
// Check if user has sufficient funds
const usageAllowed = await svc_cost.get_funding_allowed({
  minimum: cost_in_microcents,
});

// Record a cost
await svc_cost.record_cost({
  cost: cost_in_microcents,
});

// Record funding updates
await svc_cost.record_funding_update({
  old_amount: previous_amount,
  new_amount: updated_amount,
});
```

### Cost Units

Costs are tracked in microcents (1/1,000,000th of a USD cent) to allow for precise metering of very small costs. For example:

- 1 USD = 100 cents = 100,000,000 microcents
- 0.1 cents = 100,000 microcents
- 0.001 cents = 1,000 microcents

## Implementation Examples

### AI Services

AI services are a prime example of metered services in Puter. Each AI service defines its own cost structure based on usage:

#### Text Generation (e.g. MistralAI)

```javascript
{
    currency: 'usd-cents',
    tokens: 1_000_000, // per million tokens
    input: 200,  // cost for input tokens
    output: 600  // cost for output tokens
}
```

#### Text-to-Speech (AWS Polly)

```javascript
const microcents_per_character = 400;
const exact_cost = microcents_per_character * text.length;
```

#### Document Processing (AWS Textract)

```javascript
const min_cost =
  (150 * // cents per 1000 pages
    Math.pow(10, 6)) / // microcents per cent
  1000; // pages // 150,000 microcents per page
```

### Usage Pattern

Services typically follow this pattern for metered operations:

1. Calculate the exact cost or minimum cost for the operation
2. Check if the user has sufficient funds using `get_funding_allowed()`
3. If funds are available:
   - For fixed-cost operations: Record the cost immediately
   - For variable-cost operations: Record the cost after completion
4. If funds are insufficient, throw an `insufficient_funds` error

## Integration Guide

To add metering to a new service:

1. Get the CostService instance:

```javascript
const svc_cost = this.services.get("cost");
```

2. Define your cost structure:

- Use microcents as the base unit
- Consider both fixed and variable costs
- Document the cost calculation logic

3. Implement the usage check:

```javascript
const usageAllowed = await svc_cost.get_funding_allowed({
  minimum: calculated_cost,
});
if (!usageAllowed) {
  throw APIError.create("insufficient_funds");
}
```

4. Record costs appropriately:

```javascript
await svc_cost.record_cost({
  cost: final_cost,
});
```

## Related Documentation

- For AI-specific metering, see the [PuterAI documentation](../modules/puterai/README.md)
- For implementation details of CostService, see the [service documentation](../services/CostService.md)
