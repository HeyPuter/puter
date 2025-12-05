# AI Usage Testing and Reporting

This document provides guidance for testing and reporting AI usage in the Puter platform.

## Manual Testing for AI Usage Reporting

When testing AI usage reporting and tracking, it's sometimes necessary to manipulate the timestamps of usage records for testing purposes. This can be useful for validating reporting over specific time periods or for troubleshooting issues with usage limits.

### Backdating AI Usage Records

To move all records in the `ai_usage` table back by one week, you can use the following SQL query for SQLite:

```sql
UPDATE ai_usage
SET created_at = datetime(created_at, '-7 days');
```

This query updates the `created_at` timestamp for all records in the table, shifting them back by 7 days.

### Common Testing Scenarios

1. **Testing daily usage limits**: Backdate some records to earlier in the current day to test daily usage limit calculations.

2. **Testing monthly reports**: Distribute usage records across a month to validate monthly usage reports.

3. **Testing billing cycles**: Adjust record timestamps to span multiple billing cycles to ensure proper attribution.

## Usage Table Structure

The `ai_usage` table tracks all AI service usage with the following key fields:

- `user_id`: The user who made the request
- `service_name`: The AI service that was used (e.g., 'openai', 'claude')
- `model_name`: The specific model that was used
- `cost`: Expected cost in microcents (µ¢)
- `value_uint_1`: Input tokens
- `value_uint_2`: Output tokens
- `created_at`: When the usage occurred

For the complete table definition, see the [ai_usage table schema](../../../../services/database/sqlite_setup/0033_ai-usage.sql).

## Resetting Test Data

After testing, you may want to reset the timestamps to their original values. This is only possible if you've kept a backup of the original data or timestamps.