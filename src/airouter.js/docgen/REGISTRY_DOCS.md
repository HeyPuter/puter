# Provider Registry Documentation

This document describes all the providers available in the registry and how to obtain different types of values.

## Available Types

- [NORMALIZED_LLM_TOOLS](#normalized-llm-tools)
- [NORMALIZED_LLM_MESSAGES](#normalized-llm-messages)
- [USAGE_SDK_STYLE](#usage-sdk-style)
- [COERCED_TOOLS](#coerced-tools)
- [ANTHROPIC_CLIENT](#anthropic-client)
- [ASYNC_RESPONSE](#async-response)
- [SYNC_RESPONSE](#sync-response)
- [COERCED_USAGE](#coerced-usage)
- [COERCED_MESSAGES](#coerced-messages)

## NORMALIZED_LLM_TOOLS

**Requires:** `NORMALIZED_LLM_PARAMS`

**Produces:** Custom provider function


## NORMALIZED_LLM_MESSAGES

**Requires:** `NORMALIZED_LLM_PARAMS`

**Produces:** Custom provider function


## USAGE_SDK_STYLE

**Requires:** `SDK_STYLE`

**Produces:** Custom provider function


## COERCED_TOOLS

There are 4 ways to obtain **COERCED_TOOLS**:

### Option 1

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 2

**Requires:** `NORMALIZED_LLM_TOOLS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 3

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 4

**Requires:** `NORMALIZED_LLM_TOOLS`

**When:** Custom predicate function

**Produces:** Custom provider function


## ANTHROPIC_CLIENT

**Requires:** `ANTHROPIC_API_KEY`

**Produces:** Custom provider function


## ASYNC_RESPONSE

There are 2 ways to obtain **ASYNC_RESPONSE**:

### Option 1

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 2

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


## SYNC_RESPONSE

There are 2 ways to obtain **SYNC_RESPONSE**:

### Option 1

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


### Option 2

**Requires:** `NORMALIZED_LLM_PARAMS`

**When:** Custom predicate function

**Produces:** Custom provider function


## COERCED_USAGE

**Requires:** `OPENAI_USAGE`, `COERCED_USAGE`

**When:** Custom predicate function

**Produces:** Custom provider function


## COERCED_MESSAGES

**Requires:** `NORMALIZED_LLM_MESSAGES`

**When:** Custom predicate function

**Produces:** Custom provider function



---

# Dependency Tree

- USAGE_SDK_STYLE
  - SDK_STYLE
- COERCED_TOOLS
  - NORMALIZED_LLM_PARAMS
  - NORMALIZED_LLM_TOOLS
    - NORMALIZED_LLM_PARAMS
- ANTHROPIC_CLIENT
  - ANTHROPIC_API_KEY
- ASYNC_RESPONSE
  - NORMALIZED_LLM_PARAMS
- SYNC_RESPONSE
  - NORMALIZED_LLM_PARAMS
- COERCED_MESSAGES
  - NORMALIZED_LLM_MESSAGES
    - NORMALIZED_LLM_PARAMS

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


- **NORMALIZED_LLM_TOOLS**

- **NORMALIZED_LLM_MESSAGES**

- **USAGE_SDK_STYLE**

- **COERCED_TOOLS**

- **ANTHROPIC_CLIENT**

- **ASYNC_RESPONSE**

- **SYNC_RESPONSE**

- **COERCED_USAGE**

- **COERCED_MESSAGES**
