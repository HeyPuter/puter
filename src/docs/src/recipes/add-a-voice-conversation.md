---
title: Add a Voice Conversation
description: "Learn how to add a voice conversation with Puter.js, so users can speak to AI and continue after a connection drops."
tags: [ai, ui]
---

A voice conversation needs a deliberate start, a visible connection state, and
a hang-up action that releases the microphone and speaker. Prepare it with
[`puter.ai.realtime()`](/AI/realtime/), and connect from a user click. Connection
starts billed usage and requires a paid Puter plan.

The browser calls AI directly under the [User-Pays model](/user-pays-model/).
A secure context and microphone permission are required for browser audio.

## Connect From a Click

Attach a Start button before preparing or connecting a conversation:

```js
const startButton = document.createElement('button');
startButton.textContent = 'Start voice conversation';
document.body.append(startButton);
startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    let conversation;
    try {
        conversation = await puter.ai.realtime();
        conversation.on('error', event => console.error(event));
        await conversation.connect();
    } catch (error) {
        console.error(error.code, error.message);
    } finally {
        conversation?.close();
        startButton.disabled = false;
    }
});
```

This smallest version connects and immediately closes. The full code below
keeps the connection open and enables audio. It catches failures, prevents
concurrent starts, and lets Hang up cancel a pending start.

Preparation can open Puter sign-in. Connecting starts billed usage. Start a new
call only after another user click, including after a terminal connection failure.

## Enable User Transcription Before the Microphone

Configure input transcription through a native `session.update`, then wait for
`session.updated` to acknowledge it before starting capture. Puter's realtime
implementation forwards this payload and retains acknowledged settings across
reconnections:

```js
const transcriptionUpdate = {
    type: 'session.update',
    session: {
        type: 'realtime',
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } } },
    },
};
```

The full code sends this event and bounds the wait. Native event shapes are
covered by the [OpenAI realtime reference](https://developers.openai.com/api/reference/resources/realtime/client-events).
User transcript events require input transcription. Speech with a transcript
can be restored after a reconnect. Speech without one is left out of restoration.
Assistant audio already includes a transcript.

## Show Reconnection and Failures

Listen for `reconnecting` and display the gap. On `ready` with
`reconnected: true`, display that the connection returned. The SDK reconnects,
restores recent supported conversation items, and carries the microphone and
speaker over. Audio captured during reconnection is skipped.

Keep listeners attached across reconnects. The transcript UI displays final
transcripts once, using `textContent`. Restoration doesn't emit item events
again. When `context_trimmed` fires, tell the user that some older context was
left out. The [realtime reference](/AI/realtime/#return-value) describes restoration.

Show `subscription_required` and `insufficient_funds` as actions for the user.
Both connection rejections and asynchronous error events reach the same handler.
A nested native provider error is unwrapped there. Other errors stay visible
with their code and message, including `context_restore_failed`.

## Release Resources on Hang-Up

Call [`close()`](/AI/realtime/#return-value) on Hang up and `pagehide`. The SDK releases its microphone,
speaker, and connection resources. A generation counter prevents a late sign-in
or setup result from starting audio after Hang up.

## Full Code

Run this browser code on a page that loads Puter.js. Transcription must be
acknowledged before the microphone starts:

```js
const startButton = document.createElement('button');
startButton.textContent = 'Start voice conversation';
const hangUpButton = document.createElement('button');
hangUpButton.textContent = 'Hang up';
hangUpButton.disabled = true;
const status = document.createElement('p');
const transcript = document.createElement('pre');
document.body.append(startButton, hangUpButton, status, transcript);
let conversation = null;
let starting = false;
let generation = 0;

function showFailure(event) {
    const error = event.error ?? event;
    const actions = {
        subscription_required: 'Choose a paid Puter plan to use voice conversations.',
        insufficient_funds: 'Add funds to your Puter account to continue.',
        auth_required: 'Sign in to Puter to start a conversation.',
        auth_canceled: 'Sign in to Puter when you are ready to start.',
        auth_failed: 'Sign in to Puter again to continue.',
        permission_denied: 'Allow microphone access, then start again.',
    };
    status.textContent = actions[error.code]
        ?? `Voice error (${error.code ?? 'unknown'}): ${error.message}`;
    console.error(error);
}

function hangUp() {
    generation++;
    conversation?.close();
    conversation = null;
    starting = false;
    startButton.disabled = false;
    hangUpButton.disabled = true;
    status.textContent = 'Call ended.';
}

async function start() {
    if (starting || conversation) return;
    starting = true;
    const attempt = ++generation;
    startButton.disabled = true;
    hangUpButton.disabled = false;
    status.textContent = 'Preparing conversation…';
    let active;
    try {
        active = await puter.ai.realtime({ instructions: 'Keep spoken replies brief.' });
        if (attempt !== generation) {
            active.close();
            return;
        }
        conversation = active;
        active.on('error', showFailure);
        active.on('reconnecting', () => {
            status.textContent = 'Reconnecting… Microphone audio during this gap is skipped.';
        });
        active.on('ready', ({ reconnected }) => {
            status.textContent = reconnected ? 'Reconnected.' : 'Connected.';
        });
        active.on('context_trimmed', ({ omittedItems }) => {
            transcript.textContent += `\n${omittedItems} older items were left out of restored context.\n`;
        });
        active.on('transcript', ({ role, text, final }) => {
            if (final) transcript.textContent += `${role}: ${text}\n`;
        });
        active.on('close', () => {
            if (conversation !== active) return;
            conversation = null;
            startButton.disabled = false;
            hangUpButton.disabled = true;
            if (!status.textContent.startsWith('Voice error')) {
                status.textContent += ' Connection closed. Press Start for a new call.';
            }
        });
        status.textContent = 'Connecting…';
        await active.connect();
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('Transcription setup timed out.')), 15000);
            const offUpdated = active.on('session.updated', event => {
                if (event.session?.audio?.input?.transcription?.model === 'gpt-4o-mini-transcribe') finish();
            });
            const offError = active.on('error', event => finish(event.error ?? event));
            const offClose = active.on('close', () => finish(new Error('Call closed during setup.')));
            function finish(error) {
                clearTimeout(timer);
                offUpdated(); offError(); offClose();
                if (error) reject(error);
                else resolve();
            }
            try {
                active.send({ type: 'session.update', session: {
                    type: 'realtime',
                    audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } } },
                } });
            } catch (error) {
                finish(error);
            }
        });
        await active.speaker.start();
        await active.microphone.start();
        if (attempt !== generation) active.close();
        else status.textContent = 'Listening. Speak to start a turn.';
    } catch (error) {
        active?.close();
        if (attempt === generation) {
            conversation = null;
            showFailure(error);
            startButton.disabled = false;
            hangUpButton.disabled = true;
        }
    } finally {
        if (attempt === generation) starting = false;
    }
}

startButton.addEventListener('click', () => start().catch(showFailure));
hangUpButton.addEventListener('click', hangUp);
window.addEventListener('pagehide', hangUp);
```
