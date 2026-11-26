---
title: Stream AI Replies With a Stop Button
description: "Learn how to stream AI replies with Puter.js, so users can stop waiting and keep the text they already received."
tags: [ai, ui]
---

A stop button lets a user keep a useful partial answer and move on. Pass an
abort signal to [`puter.ai.chat()`](/AI/chat/) so the button also stops waiting
when the stream has paused between chunks.

Call directly from the browser under the [User-Pays model](/user-pays-model/).
The model finishes a request that has reached it, and the whole response is
billed even when the user stops receiving it.

## Read Text as It Arrives

Start with an async iterator and handle provider error chunks before text:

```js
const controller = new AbortController();
let partialReply = '';
const stream = await puter.ai.chat('Explain how rain forms.', {
    stream: true, signal: controller.signal, fallback: false,
});
for await (const chunk of stream) {
    if (chunk.type === 'error') throw new Error(chunk.message);
    if (chunk.type === 'text') partialReply += chunk.text;
}
console.log(partialReply);
```

The [chunk reference](/Objects/chatresponsechunk/) lists the other chunk types.
Appending only text keeps usage and reasoning metadata out of the displayed reply.
The default model is the cheap chat model. To offer other models, populate a
picker from [`puter.ai.listModels()`](/AI/listModels/).

## Stop While Waiting

Keep the controller outside the loop so your Stop button can call
`controller.abort()` at any time. This code creates the buttons and output
elements itself, and keeps the controller and the reply in variables that
outlive one request:

```js
const startButton = document.createElement('button');
startButton.textContent = 'Ask AI';
const stopButton = document.createElement('button');
stopButton.textContent = 'Stop';
stopButton.disabled = true;
const output = document.createElement('pre');
const status = document.createElement('p');
document.body.append(startButton, stopButton, status, output);
let controller = null;
let partialReply = '';
```

Catch the signal's own reason as a user stop. Keep `partialReply` intact in
that branch. Disable the Start button during a request so another click cannot
replace its controller. Restore both buttons in `finally`, including after a
failed call:

```js
async function streamReply(prompt) {
    if (controller) throw new Error('A reply is already running.');
    const active = new AbortController();
    controller = active;
    partialReply = '';
    output.textContent = '';
    startButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = 'Receiving reply…';
    try {
        const stream = await puter.ai.chat(prompt, {
            stream: true, signal: active.signal, fallback: false,
        });
        for await (const chunk of stream) {
            if (chunk.type === 'error') throw new Error(chunk.message);
            if (chunk.type === 'text') {
                partialReply += chunk.text;
                output.textContent = partialReply;
            }
        }
        status.textContent = active.signal.aborted ? 'Stopped. Partial reply kept.' : 'Reply complete.';
    } catch (error) {
        if (active.signal.aborted && error === active.signal.reason) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else {
            status.textContent = 'Request failed. Partial reply kept.';
            console.error(error);
        }
    } finally {
        controller = null;
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}
```

Connect the buttons to it. Stop works both during output and while waiting for
another chunk, and leaving the page stops the request too:

```js
stopButton.addEventListener('click', () => controller?.abort());
startButton.addEventListener('click', () => {
    streamReply('Explain how rain forms in three paragraphs.');
});
window.addEventListener('pagehide', () => controller?.abort());
```

## Distinguish Provider and Transport Failures

A provider failure arrives as a chunk with `type: 'error'` and a `message`.
Handle it inside the loop and mark the answer as partial. The chunk's documented
contract has no stable error code for a billing or sign-in decision.

A thrown failure arrives from the initial call or the iterator, so one
`try...catch` wraps both. The documented transport codes include
`network_error`, `invalid_stream_response`, and `request_timeout`. Display the
code and message, retain the partial answer, and let the user decide whether to
start a new request.

The `showFailure()` function turns a thrown failure into a status message. It
shows an actionable message for a sign-in, funds, or subscription failure. A
sign-in the user cancelled rejects as
`{ error: { code: 'auth_canceled', message } }`, so the function reads the
nested `error` object first. A session that expired and wasn't renewed rejects
with `status: 401` and no code. Other failures remain visible with their code
and message. A connection that fails before the stream starts rejects with
neither, and gets a fixed message:

```js
function showFailure(error) {
    const failure = error?.error && typeof error.error === 'object' ? error.error : error;
    const code = failure?.code;
    if (code === 'auth_canceled' || failure?.status === 401) {
        status.textContent = 'Sign in to Puter, then start a new request.';
    } else if (code === 'insufficient_funds') {
        status.textContent = 'Add funds to your Puter account before starting another request.';
    } else if (code === 'subscription_required') {
        status.textContent = 'Choose a paid Puter plan before starting another request.';
    } else if (code || typeof failure?.message === 'string') {
        status.textContent = `Request failed (${code ?? 'unknown'}): ${failure.message ?? 'no message'}`;
    } else {
        status.textContent = 'Request failed before the reply started. Check your connection, then start a new request.';
    }
    console.error(error);
}
```

Call it from the `catch` block of `streamReply()`. A provider error chunk and a
thrown failure use separate branches so a provider failure never looks like a
completed reply:

```js
async function streamReply(prompt) {
    if (controller) throw new Error('A reply is already running.');
    const active = new AbortController();
    controller = active;
    partialReply = '';
    output.textContent = '';
    startButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = 'Receiving reply…';
    try {
        const stream = await puter.ai.chat(prompt, {
            stream: true, signal: active.signal, fallback: false,
        });
        for await (const chunk of stream) {
            if (chunk.type === 'error') {
                status.textContent = `Provider failed: ${chunk.message}. Partial reply kept.`;
                console.error('AI provider error', chunk.message);
                return;
            }
            if (chunk.type === 'text') {
                partialReply += chunk.text;
                output.textContent = partialReply;
            }
        }
        status.textContent = active.signal.aborted ? 'Stopped. Partial reply kept.' : 'Reply complete.';
    } catch (error) {
        if (active.signal.aborted && error === active.signal.reason) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else {
            showFailure(error);
        }
    } finally {
        controller = null;
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}
```

Pass a rejection from `streamReply()` itself to the same function:

```js
startButton.addEventListener('click', () => {
    streamReply('Explain how rain forms in three paragraphs.').catch(showFailure);
});
```

## Keep the Partial Reply

Render with `textContent`, since model text can contain HTML. The `partialReply`
variable remains available after completion, cancellation, or failure, for
example for a Copy button. Mark it incomplete in the UI when stopped or failed.

A reply can also end early without an error, for example at the model's token
limit. The last chunk of a stream has `type: 'usage'` and carries a
[`finish_reason`](/Objects/chatresponsechunk/). A value other than `stop`, such
as `length` at the token limit, means the reply was cut off. This version of
`streamReply()` reads it and marks the reply incomplete:

```js
async function streamReply(prompt) {
    if (controller) throw new Error('A reply is already running.');
    const active = new AbortController();
    controller = active;
    partialReply = '';
    output.textContent = '';
    startButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = 'Receiving reply…';
    try {
        const stream = await puter.ai.chat(prompt, {
            stream: true, signal: active.signal, fallback: false,
        });
        let finishReason;
        for await (const chunk of stream) {
            if (chunk.type === 'error') {
                status.textContent = `Provider failed: ${chunk.message}. Partial reply kept.`;
                console.error('AI provider error', chunk.message);
                return;
            }
            if (chunk.type === 'text') {
                partialReply += chunk.text;
                output.textContent = partialReply;
            }
            if (chunk.type === 'usage') finishReason = chunk.finish_reason;
        }
        if (active.signal.aborted) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else if (finishReason && finishReason !== 'stop') {
            status.textContent = `Reply cut off (${finishReason}). Partial reply kept.`;
        } else {
            status.textContent = 'Reply complete.';
        }
    } catch (error) {
        if (active.signal.aborted && error === active.signal.reason) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else {
            showFailure(error);
        }
    } finally {
        controller = null;
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}
```

Each Start click makes one application call. The code uses `fallback: false`
and has no automatic retry. A failed or stopped call may already be billed, so
starting again is an explicit user action. See [stream billing](/AI/chat/#return-value)
for what stopping changes.

## Full Code

Run this in a browser page that loads Puter.js. The first click starts the
request, and Stop works both during output and while waiting for another chunk:

```js
const startButton = document.createElement('button');
startButton.textContent = 'Ask AI';
const stopButton = document.createElement('button');
stopButton.textContent = 'Stop';
stopButton.disabled = true;
const output = document.createElement('pre');
const status = document.createElement('p');
document.body.append(startButton, stopButton, status, output);
let controller = null;
let partialReply = '';

function showFailure(error) {
    const failure = error?.error && typeof error.error === 'object' ? error.error : error;
    const code = failure?.code;
    if (code === 'auth_canceled' || failure?.status === 401) {
        status.textContent = 'Sign in to Puter, then start a new request.';
    } else if (code === 'insufficient_funds') {
        status.textContent = 'Add funds to your Puter account before starting another request.';
    } else if (code === 'subscription_required') {
        status.textContent = 'Choose a paid Puter plan before starting another request.';
    } else if (code || typeof failure?.message === 'string') {
        status.textContent = `Request failed (${code ?? 'unknown'}): ${failure.message ?? 'no message'}`;
    } else {
        status.textContent = 'Request failed before the reply started. Check your connection, then start a new request.';
    }
    console.error(error);
}

async function streamReply(prompt) {
    if (controller) throw new Error('A reply is already running.');
    const active = new AbortController();
    controller = active;
    partialReply = '';
    output.textContent = '';
    startButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = 'Receiving reply…';
    try {
        const stream = await puter.ai.chat(prompt, {
            stream: true, signal: active.signal, fallback: false,
        });
        let finishReason;
        for await (const chunk of stream) {
            if (chunk.type === 'error') {
                status.textContent = `Provider failed: ${chunk.message}. Partial reply kept.`;
                console.error('AI provider error', chunk.message);
                return;
            }
            if (chunk.type === 'text') {
                partialReply += chunk.text;
                output.textContent = partialReply;
            }
            if (chunk.type === 'usage') finishReason = chunk.finish_reason;
        }
        if (active.signal.aborted) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else if (finishReason && finishReason !== 'stop') {
            status.textContent = `Reply cut off (${finishReason}). Partial reply kept.`;
        } else {
            status.textContent = 'Reply complete.';
        }
    } catch (error) {
        if (active.signal.aborted && error === active.signal.reason) {
            status.textContent = 'Stopped. Partial reply kept.';
        } else {
            showFailure(error);
        }
    } finally {
        controller = null;
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

stopButton.addEventListener('click', () => controller?.abort());
startButton.addEventListener('click', () => {
    streamReply('Explain how rain forms in three paragraphs.').catch(showFailure);
});
window.addEventListener('pagehide', () => controller?.abort());
```
