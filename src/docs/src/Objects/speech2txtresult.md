---
title: Speech2TxtResult
description: The Speech2TxtResult object containing speech-to-text transcription results.
---

The `Speech2TxtResult` object containing speech-to-text transcription results.

## Attributes

#### `text` (String)

A string containing the transcribed text from the audio.

#### `language` (String)

A string containing the detected or specified language of the audio.

#### `segments` (Array)

An optional array of segment objects containing detailed transcription information.

#### `duration` (Number)

An optional duration of the audio in seconds. Provider-dependent (e.g. returned by xAI).

#### `words` (Array)

An optional array of per-word timestamp objects. Provider-dependent (e.g. returned by xAI). Each word has:

- `text` (String): The transcribed word.
- `start` (Number): Start time of the word in seconds.
- `end` (Number): End time of the word in seconds.
- `speaker` (String): Detected speaker, present when `diarize: true`.
