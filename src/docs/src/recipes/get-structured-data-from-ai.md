---
title: Get Structured Data From AI
description: "Learn how to extract structured data with Puter.js, so your app can check AI results before using them."
tags: [ai, data-modeling]
---

An AI reply becomes application data only after your code checks it. Ask for a
JSON schema with [`puter.ai.chat()`](/AI/chat/), then validate types and business
rules before saving the result or changing anything in your app.

Call directly from the browser under the [User-Pays model](/user-pays-model/).
The instructions here are public, so the app needs no worker.

## Request a Small Object

Use [`puter.ai.listModels()`](/AI/listModels/) to select the cheap default model
and `normalize: true` to read its reply as a string:

```js
const models = await puter.ai.listModels();
const model = models.find(item => item.id === 'gpt-5.4-nano')?.puterId;
if (!model) throw new Error('The extraction model is unavailable.');
const schema = {
    type: 'object', properties: { quantity: { type: 'integer' } },
    required: ['quantity'], additionalProperties: false,
};
const reply = await puter.ai.chat('Extract the quantity from: three pencils', {
    model, normalize: true,
    outputFormat: { type: 'json_schema', name: 'quantity', strict: true, schema },
});
if (reply.finish_reason !== 'stop') {
    throw new Error(`Extraction incomplete: ${reply.finish_reason}`);
}
if (reply.message.refusal) throw new Error(`Extraction refused: ${reply.message.refusal}`);
if (!reply.message.content) throw new Error('Extraction returned no content.');
const value = JSON.parse(reply.message.content);
if (!Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 20) {
    throw new Error('quantity must be an integer between 1 and 20');
}
```

The schema constrains the shape. Your code enforces the rule that an order can
contain 1 to 20 of an item.

The three checks before `JSON.parse()` treat an incomplete or refused reply as a
failure, including when its text happens to parse. A
[`finish_reason`](/Objects/chatresponse/) other than `stop` means the reply was
cut off or filtered. A model that declines can also finish with `stop`, and then
the reply has a `message.refusal` string or no content.

## Extract Several Items Together

Put several related inputs in one call. Change the schema to an `items` array
containing one result per input ID, and put the instructions and the schema in a
system prompt:

```js
const schema = {
    type: 'object',
    properties: {
        items: { type: 'array', items: {
            type: 'object',
            properties: { id: { type: 'string' }, quantity: { type: 'integer' } },
            required: ['id', 'quantity'], additionalProperties: false,
        } },
    },
    required: ['items'], additionalProperties: false,
};
const system = 'Extract requested quantities. Return only JSON matching this schema.\n'
    + JSON.stringify(schema);
```

Validate that each ID appears exactly once, that the fields have the right
types, and that every quantity is allowed. The `validate()` function returns
every problem it finds as a string:

```js
function validate(value, ids) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return ['result must be an object'];
    }
    if (Object.keys(value).some(key => key !== 'items')) errors.push('result has extra fields');
    if (!Array.isArray(value.items)) return [...errors, 'items must be an array'];
    if (value.items.length !== ids.length) errors.push(`items must have ${ids.length} entries`);
    const seen = new Set();
    value.items.forEach((item, index) => {
        const path = `items[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(`${path} must be an object`);
            return;
        }
        if (Object.keys(item).some(key => !['id', 'quantity'].includes(key))) {
            errors.push(`${path} has extra fields`);
        }
        if (typeof item.id !== 'string' || !ids.includes(item.id)) {
            errors.push(`${path}.id must be one of ${JSON.stringify(ids)}`);
        }
        if (seen.has(item.id)) errors.push(`${path}.id must be unique`);
        seen.add(item.id);
        if (!Number.isInteger(item.quantity)) errors.push(`${path}.quantity must be an integer`);
        else if (item.quantity < 1 || item.quantity > 20) {
            errors.push(`${path}.quantity must be between 1 and 20`);
        }
    });
    return errors;
}
```

The `extract()` function checks the requests, sends them in one call, and
returns the result only when `validate()` finds no errors:

```js
async function extract(requests) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20
        || requests.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 64
            || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
        || new Set(requests.map(item => item.id)).size !== requests.length) {
        throw new Error('Supply 1 to 20 requests with unique IDs of 1 to 64 characters and text of 1 to 2000 characters.');
    }
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(requests) },
    ];
    const result = await puter.ai.chat(messages, {
        model, normalize: true, max_tokens: 2048,
        outputFormat: { type: 'json_schema', name: 'quantities', strict: true, schema },
    });
    if (result.finish_reason !== 'stop') {
        throw new Error(`Extraction incomplete: ${result.finish_reason}`);
    }
    if (result.message.refusal) throw new Error(`Extraction refused: ${result.message.refusal}`);
    if (!result.message.content) throw new Error('Extraction returned no content.');
    const value = JSON.parse(result.message.content);
    const errors = validate(value, requests.map(item => item.id));
    if (errors.length > 0) throw new Error(`AI data failed validation:\n${errors.join('\n')}`);
    return value;
}
```

Call it with a list of requests, each with its own ID:

```js
try {
    const result = await extract([
        { id: 'pencils', text: 'Please send three pencils.' },
        { id: 'notebooks', text: 'I need two notebooks.' },
    ]);
    console.log(result);
} catch (error) {
    console.error(error.code ?? 'extraction_failed', error.message);
    throw error;
}
```

This batches N items into one structured-output call. It avoids paying for the
same instructions N times. Keep each batch small enough for your chosen model.
The example uses an application batch size of 20.

## Return Exact Validation Errors

After a validation failure, append the returned assistant message and a user
message containing the exact error strings. Keep the original input in the
conversation so the model can correct the data against it. This version of
`extract()` repeats the call in a loop:

```js
async function extract(requests) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20
        || requests.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 64
            || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
        || new Set(requests.map(item => item.id)).size !== requests.length) {
        throw new Error('Supply 1 to 20 requests with unique IDs of 1 to 64 characters and text of 1 to 2000 characters.');
    }
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(requests) },
    ];
    let errors = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await puter.ai.chat(messages, {
            model, normalize: true, max_tokens: 2048,
            outputFormat: { type: 'json_schema', name: 'quantities', strict: true, schema },
        });
        if (result.finish_reason !== 'stop') {
            throw new Error(`Extraction incomplete: ${result.finish_reason}`);
        }
        if (result.message.refusal) throw new Error(`Extraction refused: ${result.message.refusal}`);
        if (!result.message.content) throw new Error('Extraction returned no content.');
        let value;
        try {
            value = JSON.parse(result.message.content);
            errors = validate(value, requests.map(item => item.id));
        } catch (error) {
            errors = [`Invalid JSON: ${error.message}`];
        }
        if (errors.length === 0) return value;
        messages.push(result.message);
        messages.push({ role: 'user', content: JSON.stringify({
            validationErrors: errors, instruction: 'Correct these errors and return the complete JSON result.',
        }) });
    }
    throw new Error(`AI data failed validation after three attempts:\n${errors.join('\n')}`);
}
```

Allow at most two correction calls after the initial attempt. If the third
result still fails, throw an error containing those validation errors. The UI
can display it and ask the user to correct the input. Network failures, sign-in
failures, and billing failures propagate immediately instead of entering the
validation retry loop. An incomplete, refused, or empty reply also throws before
the correction step. Each correction call is billed.

Keep the system prompt and schema byte-identical. Changing content and error
feedback go after the fixed prompt, so repeated calls can reuse a cached prefix.

## Use a Prompt With Another Model

The example model, `gpt-5.4-nano`, accepts `outputFormat`. OpenAI's
[structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs)
lists the OpenAI models that do. The model catalog doesn't say which models
accept it. For a model without `outputFormat`, put the same schema in the system
prompt, omit that option, and run exactly the same parser and validator.

The `system` prompt already contains the schema. Give `extract()` a
`nativeFormat` parameter and send `outputFormat` only when it's `true`:

```js
async function extract(requests, nativeFormat = true) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20
        || requests.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 64
            || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
        || new Set(requests.map(item => item.id)).size !== requests.length) {
        throw new Error('Supply 1 to 20 requests with unique IDs of 1 to 64 characters and text of 1 to 2000 characters.');
    }
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(requests) },
    ];
    let errors = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await puter.ai.chat(messages, {
            model, normalize: true, max_tokens: 2048,
            ...(nativeFormat ? { outputFormat: {
                type: 'json_schema', name: 'quantities', strict: true, schema,
            } } : {}),
        });
        if (result.finish_reason !== 'stop') {
            throw new Error(`Extraction incomplete: ${result.finish_reason}`);
        }
        if (result.message.refusal) throw new Error(`Extraction refused: ${result.message.refusal}`);
        if (!result.message.content) throw new Error('Extraction returned no content.');
        let value;
        try {
            value = JSON.parse(result.message.content);
            errors = validate(value, requests.map(item => item.id));
        } catch (error) {
            errors = [`Invalid JSON: ${error.message}`];
        }
        if (errors.length === 0) return value;
        messages.push(result.message);
        messages.push({ role: 'user', content: JSON.stringify({
            validationErrors: errors, instruction: 'Correct these errors and return the complete JSON result.',
        }) });
    }
    throw new Error(`AI data failed validation after three attempts:\n${errors.join('\n')}`);
}
```

To use a model without `outputFormat`, change the model ID at the top and call
`extract(requests, false)`. A model that returns invalid JSON gets the same
bounded correction loop.

## Reuse a Validated Result

Hash the model, instructions, schema, mode, and inputs to make a cache key.
Check [`puter.kv.get()`](/KV/get/) before calling AI. Validate cached results
with the same rules, then return them. Save a successful result with
[`puter.kv.set()`](/KV/set/) and pass the time it expires as the third argument,
a Unix time in seconds:

```js
async function extract(requests, nativeFormat = true) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20
        || requests.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 64
            || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
        || new Set(requests.map(item => item.id)).size !== requests.length) {
        throw new Error('Supply 1 to 20 requests with unique IDs of 1 to 64 characters and text of 1 to 2000 characters.');
    }
    const input = JSON.stringify({ model, system, nativeFormat, requests });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const cacheKey = `ai:quantities:${hash}`;
    const ids = requests.map(item => item.id);
    const cached = await puter.kv.get(cacheKey);
    if (cached !== null && validate(cached, ids).length === 0) return cached;
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(requests) },
    ];
    let errors = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await puter.ai.chat(messages, {
            model, normalize: true, max_tokens: 2048,
            ...(nativeFormat ? { outputFormat: {
                type: 'json_schema', name: 'quantities', strict: true, schema,
            } } : {}),
        });
        if (result.finish_reason !== 'stop') {
            throw new Error(`Extraction incomplete: ${result.finish_reason}`);
        }
        if (result.message.refusal) throw new Error(`Extraction refused: ${result.message.refusal}`);
        if (!result.message.content) throw new Error('Extraction returned no content.');
        let value;
        try {
            value = JSON.parse(result.message.content);
            errors = validate(value, requests.map(item => item.id));
        } catch (error) {
            errors = [`Invalid JSON: ${error.message}`];
        }
        if (errors.length === 0) {
            const expireAt = Math.floor(Date.now() / 1000) + 60 * 60;
            await puter.kv.set(cacheKey, value, expireAt);
            return value;
        }
        messages.push(result.message);
        messages.push({ role: 'user', content: JSON.stringify({
            validationErrors: errors, instruction: 'Correct these errors and return the complete JSON result.',
        }) });
    }
    throw new Error(`AI data failed validation after three attempts:\n${errors.join('\n')}`);
}
```

The cache belongs to this app and user. Its one-hour lifetime is an application
choice. Changing the schema or model changes the key. Generated images and audio
belong in [files](/FS/), with only the file path in KV. Cache text and small JSON
results here.

For an input already in Puter's filesystem, attach its `puter_path` in a file
content block as shown in [chat file inputs](/AI/chat/#messages-array). Reuse
that path on subsequent calls. A stored file can be sent directly, so repeated
uploads and base64 conversion add no value to this pattern.

## Full Code

This example checks types, extra fields, IDs, duplicates, and quantities. Only a
validated object leaves `extract()`:

```js
const models = await puter.ai.listModels();
const model = models.find(item => item.id === 'gpt-5.4-nano')?.puterId;
if (!model) throw new Error('The extraction model is unavailable.');
const schema = {
    type: 'object',
    properties: {
        items: { type: 'array', items: {
            type: 'object',
            properties: { id: { type: 'string' }, quantity: { type: 'integer' } },
            required: ['id', 'quantity'], additionalProperties: false,
        } },
    },
    required: ['items'], additionalProperties: false,
};
const system = 'Extract requested quantities. Return only JSON matching this schema.\n'
    + JSON.stringify(schema);

function validate(value, ids) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return ['result must be an object'];
    }
    if (Object.keys(value).some(key => key !== 'items')) errors.push('result has extra fields');
    if (!Array.isArray(value.items)) return [...errors, 'items must be an array'];
    if (value.items.length !== ids.length) errors.push(`items must have ${ids.length} entries`);
    const seen = new Set();
    value.items.forEach((item, index) => {
        const path = `items[${index}]`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(`${path} must be an object`);
            return;
        }
        if (Object.keys(item).some(key => !['id', 'quantity'].includes(key))) {
            errors.push(`${path} has extra fields`);
        }
        if (typeof item.id !== 'string' || !ids.includes(item.id)) {
            errors.push(`${path}.id must be one of ${JSON.stringify(ids)}`);
        }
        if (seen.has(item.id)) errors.push(`${path}.id must be unique`);
        seen.add(item.id);
        if (!Number.isInteger(item.quantity)) errors.push(`${path}.quantity must be an integer`);
        else if (item.quantity < 1 || item.quantity > 20) {
            errors.push(`${path}.quantity must be between 1 and 20`);
        }
    });
    return errors;
}

async function extract(requests, nativeFormat = true) {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20
        || requests.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 64
            || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000)
        || new Set(requests.map(item => item.id)).size !== requests.length) {
        throw new Error('Supply 1 to 20 requests with unique IDs of 1 to 64 characters and text of 1 to 2000 characters.');
    }
    const input = JSON.stringify({ model, system, nativeFormat, requests });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const cacheKey = `ai:quantities:${hash}`;
    const ids = requests.map(item => item.id);
    const cached = await puter.kv.get(cacheKey);
    if (cached !== null && validate(cached, ids).length === 0) return cached;
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(requests) },
    ];
    let errors = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await puter.ai.chat(messages, {
            model, normalize: true, max_tokens: 2048,
            ...(nativeFormat ? { outputFormat: {
                type: 'json_schema', name: 'quantities', strict: true, schema,
            } } : {}),
        });
        if (result.finish_reason !== 'stop') {
            throw new Error(`Extraction incomplete: ${result.finish_reason}`);
        }
        if (result.message.refusal) throw new Error(`Extraction refused: ${result.message.refusal}`);
        if (!result.message.content) throw new Error('Extraction returned no content.');
        let value;
        try {
            value = JSON.parse(result.message.content);
            errors = validate(value, requests.map(item => item.id));
        } catch (error) {
            errors = [`Invalid JSON: ${error.message}`];
        }
        if (errors.length === 0) {
            const expireAt = Math.floor(Date.now() / 1000) + 60 * 60;
            await puter.kv.set(cacheKey, value, expireAt);
            return value;
        }
        messages.push(result.message);
        messages.push({ role: 'user', content: JSON.stringify({
            validationErrors: errors, instruction: 'Correct these errors and return the complete JSON result.',
        }) });
    }
    throw new Error(`AI data failed validation after three attempts:\n${errors.join('\n')}`);
}

try {
    const result = await extract([
        { id: 'pencils', text: 'Please send three pencils.' },
        { id: 'notebooks', text: 'I need two notebooks.' },
    ]);
    console.log(result);
} catch (error) {
    console.error(error.code ?? 'extraction_failed', error.message);
    throw error;
}
```
