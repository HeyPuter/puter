# AI Drivers

Where the AI driver code lives under [src/backend/drivers/ai/](../src/backend/drivers/ai/), what each folder owns, and how to add a provider or a new AI interface. The general layer rules are in [architecture.md](architecture.md) and [AGENTS.md](../AGENTS.md#backend). This page covers what is specific to AI.

## Layout

```text
src/backend/drivers/ai/
├── interfaces/    Puter-facing drivers, one folder per AI interface
├── providers/     Vendor code, as providers/<vendor>/<interface>/
├── protocols/     Wire protocols that several vendors speak
└── shared/        Helpers that more than one interface uses
```

| Folder | Owns | Example |
| --- | --- | --- |
| `interfaces/<interface>/` | The driver class, the interface's contracts in `types.ts`, its provider base class where one exists, and the helpers and tests that apply to every provider of that interface. | [interfaces/chat/ChatCompletionDriver.ts](../src/backend/drivers/ai/interfaces/chat/ChatCompletionDriver.ts) |
| `providers/<vendor>/<interface>/` | One vendor's implementation of one interface: the adapter, its model catalog and prices, its fixtures, and its tests. | [providers/gemini/video/](../src/backend/drivers/ai/providers/gemini/video/) |
| `providers/<vendor>/` | Helpers that several of that vendor's interfaces use. | [providers/gemini/geminiRest.ts](../src/backend/drivers/ai/providers/gemini/geminiRest.ts) |
| `protocols/openaiCompatible/` | The OpenAI wire protocol: the base provider class, message and usage conversion, and parameter mapping for Chat Completions and Responses. | [protocols/openaiCompatible/OpenAICompatProvider.ts](../src/backend/drivers/ai/protocols/openaiCompatible/OpenAICompatProvider.ts) |
| `shared/` | Helpers that more than one interface uses: limits, the provider registry, the remote catalog cache, job polling, streamed charging, and media input. | [shared/aiLimits.ts](../src/backend/drivers/ai/shared/aiLimits.ts) |

Helpers that non-AI code also uses stay in [src/backend/drivers/util/](../src/backend/drivers/util/): file input, data URIs, upstream error mapping, and stream piping.

AI code that a service also needs lives in [src/backend/util/](../src/backend/util/), because a service can't import from the driver layer. The realtime relay in `services/realtime/` bills through the same cost factor as the drivers, so these three files are there:

| File | Holds |
| --- | --- |
| [aiCostFactor.ts](../src/backend/util/aiCostFactor.ts) | `withAiCostFactor`, the metering view every AI driver and the realtime relay record usage through, and `withAiCreditHold`. |
| [aiProviderKey.ts](../src/backend/util/aiProviderKey.ts) | `readProviderKey`, which reads an API key from `config.providers` blocks. |
| [aiPrices.ts](../src/backend/util/aiPrices.ts) | Vendor prices that a driver and a service both bill. |

### Interfaces

| Folder | Driver | `driverInterface` | `driverName` | Key in `puterDrivers` |
| --- | --- | --- | --- | --- |
| `interfaces/chat/` | `ChatCompletionDriver` | `puter-chat-completion` | `ai-chat` | `aiChat` |
| `interfaces/image/` | `ImageGenerationDriver` | `puter-image-generation` | `ai-image` | `aiImage` |
| `interfaces/video/` | `VideoGenerationDriver` | `puter-video-generation` | `ai-video` | `aiVideo` |
| `interfaces/textToSpeech/` | `TTSDriver` | `puter-tts` | `ai-tts` | `aiTts` |
| `interfaces/speechToText/` | `SpeechToTextDriver` | `puter-speech2txt` | `ai-speech2txt` | `aiSpeech2Txt` |
| `interfaces/speechToSpeech/` | `VoiceChangerDriver` | `puter-speech2speech` | `ai-speech2speech` | `aiSpeech2Speech` |
| `interfaces/ocr/` | `OCRDriver` | `puter-ocr` | `ai-ocr` | `aiOcr` |

Folder names are not runtime identifiers. `driverInterface`, `driverName`, driver aliases, the keys under `providers` in config, provider ids, model ids, and usage keys are public contracts. Moving or renaming a file never changes them.

## Request flow

A call goes from the interface to a provider, and from there to a shared protocol when the vendor speaks one:

```text
interfaces/chat/ChatCompletionDriver.ts
    validates the call, picks the model and provider, holds credits
  → providers/deepseek/chat/DeepSeekProvider.ts
        DeepSeek's catalog, endpoint, and request differences
    → protocols/openaiCompatible/OpenAICompatProvider.ts
          the OpenAI-compatible request, response, and stream handling
```

A provider whose vendor has its own API, such as `ClaudeProvider` or `ElevenLabsTTSProvider`, implements the interface's contract directly and uses no protocol.

## Import rules

- `shared/` imports nothing from `interfaces/`, `providers/`, or `protocols/`.
- Nothing in `services/`, `stores/`, or `clients/` imports from `drivers/ai/`. Code that a service and a driver both need goes in `src/backend/util/`.
- `providers/` and `protocols/` import an interface's `types.ts` and helpers. They never import a driver class. Their tests can, to drive a provider through the real driver.
- Only an interface's driver file imports providers, to register them. The interface's helpers don't.
- An interface doesn't import another interface. When a second interface needs a helper, move the helper to `shared/`, or to `providers/<vendor>/` when it belongs to one vendor.
- A vendor folder imports another vendor's folder only when it serves that vendor's models. `providers/azure/` reads the OpenAI and xAI catalogs for that reason.

## Where a file goes

| The code is | It goes in |
| --- | --- |
| Input validation, gates, routing, credit holds, or anything else every provider of the interface gets | `interfaces/<interface>/` |
| A request or response contract that providers implement | `interfaces/<interface>/types.ts` |
| A vendor's endpoint, request shape, catalog, prices, or quirks | `providers/<vendor>/<interface>/` |
| A vendor's auth, REST plumbing, or constants that two of its interfaces use | `providers/<vendor>/` |
| Behavior of a wire protocol that several vendors speak | `protocols/<protocol>/` |
| A helper that two or more interfaces use and that belongs to no vendor | `shared/` |
| A helper that non-AI drivers or controllers also use | `src/backend/drivers/util/` |
| AI code that a service also uses | `src/backend/util/`, in a file named `ai<Something>.ts` |

Keep a helper next to its only consumer. Move it up when a second consumer appears, not before.

When one Puter option becomes a different request shape per vendor, the interface reads the option and each dialect maps it. The chat `compaction` option is read in `interfaces/chat/utils/compaction.js`, mapped for OpenAI by `toOpenAiContextManagement` in `protocols/openaiCompatible/openaiParams.ts`, and mapped for Anthropic by `toAnthropicContextManagement` in `providers/claude/chat/contextManagement.ts`. Tools work the same way: `normalize_tools_object` in the interface, then `toolsToWire` for OpenAI and `claudeToolPolicy` for Anthropic.

Tests sit next to the code they test. Fixtures go in a `fixtures/` folder next to the test that reads them.

## Adding a provider

1. Create `providers/<vendor>/<interface>/`. Use the vendor's existing folder if it has one, so all of a vendor's interfaces stay together.
2. Implement the interface's contract from `interfaces/<interface>/types.ts`:

    | Interface | Contract | Base class |
    | --- | --- | --- |
    | chat | `IChatProvider` | `OpenAICompatProvider` for an OpenAI-compatible vendor |
    | image | `IImageProvider` | none |
    | video | `IVideoProvider` | `VideoProvider` |
    | textToSpeech | `ITTSProvider` | none |
    | speechToText | `ISpeechToTextProvider` | `SpeechToTextProvider` |
    | ocr | `IOcrProvider` | none |

    Speech to speech has one provider, so `VoiceChangerDriver` uses `ElevenLabsSpeechToSpeechProvider` directly. Add a contract to its `types.ts` when a second provider needs one.

3. Put the model catalog and prices in the same folder, as `models.ts` or `costs.ts`. A provider that loads its catalog from the vendor wraps the fetch in `cachedRemoteCatalog` from `shared/`.
4. Register the provider in the interface's driver: in `#registerProviders()`, or in `onServerStart()` for OCR and speech to speech. A chat provider built from an API key and an optional base URL is one row in `KEYED_PROVIDERS` instead. Text to speech and speech to text also list the provider id and its aliases in `providerAliases.ts`.
5. Read credentials from `config.providers[<key>]`. The key is part of the self-hosting config contract, so reuse the vendor's existing key when it has one.
6. Add tests next to the provider. Mock the vendor SDK or `fetch` at the network boundary and drive the provider through the real driver where you can. A live test is a `*.integration.test.ts` file that skips itself, with `skipUnlessEnv` from [testEnv.ts](../src/backend/testEnv.ts), unless its `PUTER_TEST_AI_*` variable is set. Helpers for provider tests are in [shared/integrationTestUtil.ts](../src/backend/drivers/ai/shared/integrationTestUtil.ts).
7. For a chat provider, add its static catalog to `CATALOGS` in [modelCatalogs.test.ts](../src/backend/drivers/ai/interfaces/chat/modelCatalogs.test.ts) and the provider to [providerConsistency.test.ts](../src/backend/drivers/ai/interfaces/chat/providerConsistency.test.ts). The catalog test fails when a `providers/*/chat/` file with "model" in its name exports a catalog that isn't listed.
8. Add the provider's config key to the `providers` config of the interface's [fuzz suite](#fuzz-tests), and its id to the list of providers the suite expects.
9. Update the published docs for the models and limits the provider adds, following [contributing-apis.md](contributing-apis.md).

### OpenAI-compatible vendors

A vendor that speaks the OpenAI Chat Completions protocol extends `OpenAICompatProvider` and overrides only what differs. It still gets its own `providers/<vendor>/chat/` folder.

Vendors share one constants-only folder only when at least six of them differ in nothing but base URL and model catalog. Each then becomes one data file under `providers/openaiCompatible/providers/`, read by a single implementation. No vendor qualifies today, because every subclass overrides request, catalog, or billing behavior.

## Fuzz tests

Two seeded suites send malformed input through the real drivers and providers. They run with the rest of the backend tests.

| Suite | Covers |
| --- | --- |
| [interfaces/chat/ChatCompletionDriver.fuzz.test.ts](../src/backend/drivers/ai/interfaces/chat/ChatCompletionDriver.fuzz.test.ts) | Chat requests with a few values changed, and valid requests against wrong statuses, bodies of the wrong shape, and broken event streams. |
| [interfaces/mediaDrivers.fuzz.test.ts](../src/backend/drivers/ai/interfaces/mediaDrivers.fuzz.test.ts) | Image, video, speech and OCR requests with a few values changed. Every vendor refuses the request. |

What the suites assert:

- A malformed request never fails with an error that has no status, which `/drivers/call` would report as an unclassified 500.
- For chat, with the vendors answering, a malformed request also never fails with a 5xx and never marks a route unhealthy.
- When the upstream misbehaves, chat ends with an answer or an `HttpError`. A stream only has to end: the error line a stream carries isn't checked, so a malformed event can still end one with a 500.

The vendors are played at the HTTP boundary by `upstream` in [shared/fuzzTestUtil.ts](../src/backend/drivers/ai/shared/fuzzTestUtil.ts), which stands in for global `fetch`, undici `fetch` and axios, and makes `https.request` throw so an SDK with its own client fails the suite. The vendors' SDKs run, except Groq's, which is swapped for the OpenAI SDK, and the AWS clients, whose `send` is stubbed. The media suite calls the drivers as a user with unlimited metering, so a request gets past file input and the credit hold to the vendor. A provider that loads its catalog from the vendor registers no models there, so the suites skip it.

A failure lists each distinct finding with its case number and input. The random source is seeded, so the same case fails again on the next run. To search further, raise the case count:

```sh
PUTER_FUZZ_CASES=100000 npx vitest run --config src/backend/vitest.config.ts src/backend/drivers/ai/interfaces/chat/ChatCompletionDriver.fuzz.test.ts
```

When a suite finds a crash, validate the value where the request enters, in the driver or in `normalize_single_message`, so every provider is covered. Reject only what crashed: a value a provider ignored or refused before must still reach it. An option a driver reads as text, a number or a flag goes in the driver's `SCALAR_OPTIONS`, and `assertScalarOptions` from `shared/scalarOptions.ts` answers 400 for a value there that can't be converted to text. Add a unit test for the case next to the fix.

## Adding an interface

1. Create `interfaces/<interface>/` with the driver class and a `types.ts` for the contracts providers implement.
2. Register the driver in [src/backend/drivers/index.ts](../src/backend/drivers/index.ts).
3. Use `AI_RATE_LIMIT` and `AI_CONCURRENT` from `shared/aiLimits.ts`, and publish any new limit in [rate-limits-and-quotas.md](../src/docs/src/rate-limits-and-quotas.md).
4. Meter through `withAiCostFactor` from `src/backend/util/aiCostFactor.ts`, and route between providers with `ProviderRegistry` from `shared/providerRegistry.ts`.
5. List the options the providers read as text, a number or a flag in a `SCALAR_OPTIONS` array, and call `assertScalarOptions` from `shared/scalarOptions.ts` first in each method. Add the driver to [mediaDrivers.fuzz.test.ts](../src/backend/drivers/ai/interfaces/mediaDrivers.fuzz.test.ts).
6. Follow [contributing-apis.md](contributing-apis.md) for the puter.js method, types, docs, and tests.
