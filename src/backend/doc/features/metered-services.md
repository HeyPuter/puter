# Metered Services in Puter

Puter implements metered services through a centralized cost tracking and credit management system. This document describes the core mechanisms that enable metered services in Puter's open-source codebase.

## Overview

Metered services in Puter are managed through the `CostService`, which provides a unified interface for:

- Checking available credits
- Recording service costs
- Tracking funding updates

While the specific funding logic and credit allocation may vary in different Puter deployments (e.g., puter.com), the underlying mechanism remains consistent.

## Core Components

### CostService

Location: `src/backend/src/services/drivers/CostService.js`

The CostService is the central component for metered services, providing the following key functionalities:

1. **Credit Availability Check**

   ```javascript
   async get_funding_allowed(options = { minimum: 100 })
   ```

   - Verifies if sufficient credits are available for an operation
   - Default minimum threshold is 100 (1/10th of a cent)
   - Returns boolean indicating if funding is allowed

2. **Cost Recording**

   ```javascript
   async record_cost({ cost })
   ```

   - Records the cost of an operation
   - Associates costs with the current actor
   - Emits events for credit tracking

3. **Funding Updates**
   ```javascript
   async record_funding_update({ old_amount, new_amount })
   ```
   - Tracks changes in user funding
   - Maintains audit trail of funding modifications

## Event System

CostService uses an event-based architecture to communicate with other system components:

- `credit.check-available`: Checks available credits
- `credit.record-cost`: Records operation costs
- `credit.funding-update`: Tracks funding changes

## Integration

### Using CostService in Modules

To integrate metered services in a module:

1. Access the service:

   ```javascript
   const costService = services.get("cost");
   ```

2. Check funding before expensive operations:

   ```javascript
   const fundingAllowed = await costService.get_funding_allowed({
     minimum: requiredAmount,
   });
   if (!fundingAllowed) {
     throw new Error("Insufficient credits");
   }
   ```

3. Record costs after operations:
   ```javascript
   await costService.record_cost({ cost: operationCost });
   ```

## Security Considerations

- All cost operations are associated with the current actor
- Cost recording includes audit logging
- Minimum thresholds prevent micro-transactions

## Related Documentation

- For AI-specific metering, see: [PuterAI Documentation](../modules/puterai/README.md)
- For driver implementation details: [How to Make a Driver](../howto_make_driver.md)
