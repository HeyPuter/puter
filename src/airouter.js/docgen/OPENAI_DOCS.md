# Provider Registry Documentation

This document describes all the providers available in the registry and how to obtain different types of values.

## Available Types

- [COERCED_TOOLS](#coerced-tools)
- [COERCED_USAGE](#coerced-usage)
- [ASYNC_RESPONSE](#async-response)
- [SYNC_RESPONSE](#sync-response)
- [COERCED_MESSAGES](#coerced-messages)

## COERCED_TOOLS

There are 2 ways to obtain **COERCED_TOOLS**:

### Option 1

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 2

**Requires:** `NORMALIZED_LLM_TOOLS`

**When:** Custom predicate function

**Produces:** Custom provider function


## COERCED_USAGE

**Requires:** `OPENAI_USAGE`, `COERCED_USAGE`

**When:** Custom predicate function

**Produces:** Custom provider function


## ASYNC_RESPONSE

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


## SYNC_RESPONSE

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


## COERCED_MESSAGES

**Requires:** `NORMALIZED_LLM_MESSAGES`

**When:** Custom predicate function

**Produces:** Custom provider function



---

# Dependency Tree

- COERCED_TOOLS
  - NORMALIZED_LLM_PARAMS
  - NORMALIZED_LLM_TOOLS
- ASYNC_RESPONSE
  - NORMALIZED_LLM_PARAMS
- SYNC_RESPONSE
  - NORMALIZED_LLM_PARAMS
- COERCED_MESSAGES
  - NORMALIZED_LLM_MESSAGES

---

# Usage Examples

## Basic Usage

```javascript

const registry = new Registry();

const obtain = registry.getObtainAPI();


// Obtain a value with required inputs

const result = await obtain(OUTPUT_TYPE, {

  [INPUT_TYPE]: "input value"

});

```


## Available Providers

The following types can be obtained:


- **COERCED_TOOLS**

- **COERCED_USAGE**

- **ASYNC_RESPONSE**

- **SYNC_RESPONSE**

- **COERCED_MESSAGES**
