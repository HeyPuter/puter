---
title: Speech2TxtResult
description: The Speech2TxtResult object containing speech-to-text transcription results.
---

The `Speech2TxtResult` object containing speech-to-text transcription results.

## Attributes

#### `text` (String)

A string containing the transcribed text from the audio.

#### `model` (String)

An optional string naming the model that produced the transcript.

#### `language` (String)

An optional string containing the detected or specified language of the audio. With Gemini, this field contains the `language` option you passed and is omitted otherwise. For OpenAI and xAI, whether it is present depends on the provider response.

#### `segments` (Array)

An optional array of segment objects containing detailed transcription information.

#### `duration` (Number)

An optional duration of the audio in seconds. Provider-dependent (e.g. returned by xAI).

#### `words` (Array)

An optional array of per-word timestamp objects. Provider-dependent (returned by xAI, and by Gemini when you pass `timestamp_granularities: ['word']` or `diarize: true`). Each word has:

- `text` (String): The transcribed word.
- `start` (Number): Start time of the word in seconds.
- `end` (Number): End time of the word in seconds.
- `speaker` (String): Detected speaker, present when `diarize: true` and the provider labels the word (for example `spk:0` on Gemini).
