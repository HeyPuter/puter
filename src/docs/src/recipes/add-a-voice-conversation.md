---
title: Add a Voice Conversation
description: "Learn how to add a voice conversation with Puter.js, so users can speak to AI and continue after a connection drops."
tags: [ai, ui]
---

A voice conversation needs a deliberate start, a visible connection state, and
a hang-up action that releases the microphone and speaker. Prepare it with
[`puter.ai.realtime()`](/AI/realtime/), and connect from a user click. Connecting
requires a paid Puter plan and enough credit. Each reply and each input
transcription is billed to the signed-in user.

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

This smallest version connects and immediately closes. The next sections keep
the connection open, enable audio, show failures, and add a Hang up button.

Preparation can open Puter sign-in. Connecting is refused without a paid plan
or enough credit. Once connected, each reply and each input transcription is
billed. Start a new call only after another user click, including after a
terminal connection failure.

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

Native event shapes are covered by the [OpenAI realtime reference](https://developers.openai.com/api/reference/resources/realtime/client-events).
User transcript events require input transcription. Speech with a transcript
can be restored after a reconnect. Speech without one is left out of restoration.
Assistant audio already includes a transcript.

Send the update with [`send()`](/AI/realtime/#return-value) once the
conversation is connected. The function below takes that conversation as
`active`. It resolves when a `session.updated` event reports the transcription
model. It rejects after 15 seconds, on an error, or when the call closes, so the
wait is bounded:

```js
const transcriptionModel = transcriptionUpdate.session.audio.input.transcription.model;

function enableTranscription(active) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Transcription setup timed out.')), 15000);
        const offUpdated = active.on('session.updated', event => {
            if (event.session?.audio?.input?.transcription?.model === transcriptionModel) finish();
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
            active.send(transcriptionUpdate);
        } catch (error) {
            finish(error);
        }
    });
}
```

Await it after [`connect()`](/AI/realtime/#return-value) resolves and before
[`microphone.start()`](/AI/realtime/#browser-media).

## Show Reconnection and Failures

The page needs a status line, a transcript, and a Hang up button. Add them next
to the Start button, with a variable that holds the current conversation:

```js
const hangUpButton = document.createElement('button');
hangUpButton.textContent = 'Hang up';
hangUpButton.disabled = true;
const status = document.createElement('p');
const transcript = document.createElement('pre');
document.body.append(startButton, hangUpButton, status, transcript);
let conversation = null;
```

Show `subscription_required` and `insufficient_funds` as actions for the user.
Both connection rejections and asynchronous error events reach the same handler.
A nested native provider error is unwrapped there. Other errors stay visible
with their code and message, including `context_restore_failed`:

```js
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
```

Listen for [`reconnecting`](/AI/realtime/#convenience-events) and display the
gap. On [`ready`](/AI/realtime/#convenience-events) with `reconnected: true`,
display that the connection returned. The SDK reconnects, restores recent
supported conversation items, and carries the microphone and speaker over. Audio
captured during reconnection is skipped.

Keep listeners attached across reconnects. The transcript UI displays final
transcripts once, using `textContent`. Restoration doesn't emit item events
again. When [`context_trimmed`](/AI/realtime/#convenience-events) fires, tell
the user that some older context was left out. The
[realtime reference](/AI/realtime/#return-value) describes restoration. Attach
every listener before connecting:

```js
function attachListeners(active) {
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
}
```

A closed conversation can't reconnect. The `close` listener clears
`conversation` and enables Start again, so the user can start a new call.

## Release Resources on Hang-Up

Call [`close()`](/AI/realtime/#return-value) on Hang up and `pagehide`. The
SDK releases its microphone, speaker, and connection resources. A generation
counter prevents a late sign-in or setup result from starting audio after Hang
up. A second flag prevents concurrent starts:

```js
let starting = false;
let generation = 0;
```

Hang up moves the counter on, closes the current conversation, and resets the
buttons:

```js
function hangUp() {
    generation++;
    conversation?.close();
    conversation = null;
    starting = false;
    startButton.disabled = false;
    hangUpButton.disabled = true;
    status.textContent = 'Call ended.';
}
```

The `start()` function replaces the click handler from the first section. It
keeps the connection open, waits for `enableTranscription()`, and then starts
the speaker and the microphone. It takes the next counter value as `attempt`.
When Hang up ran while it was waiting, `attempt` differs from `generation`, and
it closes the conversation instead of continuing:

```js
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
        attachListeners(active);
        status.textContent = 'Connecting…';
        await active.connect();
        await enableTranscription(active);
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
const transcriptionUpdate = {
    type: 'session.update',
    session: {
        type: 'realtime',
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } } },
    },
};
const transcriptionModel = transcriptionUpdate.session.audio.input.transcription.model;

function enableTranscription(active) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Transcription setup timed out.')), 15000);
        const offUpdated = active.on('session.updated', event => {
            if (event.session?.audio?.input?.transcription?.model === transcriptionModel) finish();
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
            active.send(transcriptionUpdate);
        } catch (error) {
            finish(error);
        }
    });
}

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

function attachListeners(active) {
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
        attachListeners(active);
        status.textContent = 'Connecting…';
        await active.connect();
        await enableTranscription(active);
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
