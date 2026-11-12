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
| `shared/` | Helpers that more than one interface uses: limits, the cost factor, the provider registry, the remote catalog cache, job polling, and media input. | [shared/aiLimits.ts](../src/backend/drivers/ai/shared/aiLimits.ts) |

Helpers that non-AI code also uses stay in [src/backend/drivers/util/](../src/backend/drivers/util/): file input, data URIs, upstream error mapping, and stream piping.

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
- `providers/` and `protocols/` import an interface's `types.ts` and helpers. They never import a driver class.
- A driver imports its providers to register them.
- An interface doesn't import another interface. When a second interface needs a helper, move the helper to `shared/`, or to `providers/<vendor>/` when it belongs to one vendor.
- A vendor folder imports another vendor's folder only when it serves that vendor's models. `providers/azure/` reads the OpenAI and xAI catalogs for that reason.

### Not split out yet

Two places still break these rules:

- `OCRDriver` calls AWS Textract and Mistral itself. Only the Textract price list lives in `providers/awsTextract/ocr/`.
- `VoiceChangerDriver` calls ElevenLabs itself and reads the output formats from the ElevenLabs text-to-speech provider.

## Where a file goes

| The code is | It goes in |
| --- | --- |
| Input validation, gates, routing, credit holds, or anything else every provider of the interface gets | `interfaces/<interface>/` |
| A request or response contract that providers implement | `interfaces/<interface>/types.ts` |
| A vendor's endpoint, request shape, catalog, prices, or quirks | `providers/<vendor>/<interface>/` |
| A vendor's auth, REST plumbing, or constants that two of its interfaces use | `providers/<vendor>/` |
| Behavior of a wire protocol that several vendors speak | `protocols/<protocol>/` |
| A helper that two or more interfaces use and that belongs to no vendor | `shared/` |
| A helper that non-AI drivers, controllers, or services also use | `src/backend/drivers/util/` or `src/backend/util/` |

Keep a helper next to its only consumer. Move it up when a second consumer appears, not before.

Tests sit next to the code they test. Fixtures go in a `fixtures/` folder next to the test that reads them.

## Adding a provider

1. Create `providers/<vendor>/<interface>/`. Use the vendor's existing folder if it has one, so all of a vendor's interfaces stay together.
2. Implement the interface's contract from `interfaces/<interface>/types.ts`:

    | Interface | Contract | Base class |
    | --- | --- | --- |
    | chat | `IChatProvider` | `OpenAICompatProvider` for an OpenAI-compatible vendor |
    | image | `IImageProvider` | `ImageProvider` |
    | video | `IVideoProvider` | `VideoProvider` |
    | textToSpeech | `ITTSProvider` | none |
    | speechToText | `ISpeechToTextProvider` | `SpeechToTextProvider` |

3. Put the model catalog and prices in the same folder, as `models.ts` or `costs.ts`. A provider that loads its catalog from the vendor wraps the fetch in `cachedRemoteCatalog` from `shared/`.
4. Register the provider in the interface's driver, in `#registerProviders()`. A chat provider built from an API key and an optional base URL is one row in `KEYED_PROVIDERS` instead. Text to speech and speech to text also list the provider id and its aliases in `providerAliases.ts`.
5. Read credentials from `config.providers[<key>]`. The key is part of the self-hosting config contract, so reuse the vendor's existing key when it has one.
6. Add tests next to the provider. Mock the vendor SDK or `fetch` at the network boundary and drive the provider through the real driver where you can. A live test is a `*.integration.test.ts` file that skips itself unless its `PUTER_TEST_AI_*` variable is set; see [integrationTestUtil.ts](../src/backend/drivers/integrationTestUtil.ts).
7. For a chat provider, add its static catalog to `CATALOGS` in [modelCatalogs.test.ts](../src/backend/drivers/ai/interfaces/chat/modelCatalogs.test.ts) and the provider to [providerConsistency.test.ts](../src/backend/drivers/ai/interfaces/chat/providerConsistency.test.ts). The catalog test fails when a `providers/*/chat/` file with "model" in its name exports a catalog that isn't listed.
8. Update the published docs for the models and limits the provider adds, following [contributing-apis.md](contributing-apis.md).

### OpenAI-compatible vendors

A vendor that speaks the OpenAI Chat Completions protocol extends `OpenAICompatProvider` and overrides only what differs. It still gets its own `providers/<vendor>/chat/` folder.

A vendor moves into a shared constants-only folder only when at least six vendors differ in nothing but base URL and model catalog. No vendor qualifies today, because every subclass overrides request, catalog, or billing behavior.

## Adding an interface

1. Create `interfaces/<interface>/` with the driver class and a `types.ts` for the contracts providers implement.
2. Register the driver in [src/backend/drivers/index.ts](../src/backend/drivers/index.ts).
3. Use `AI_RATE_LIMIT` and `AI_CONCURRENT` from `shared/aiLimits.ts`, and publish any new limit in [rate-limits-and-quotas.md](../src/docs/src/rate-limits-and-quotas.md).
4. Meter through `withAiCostFactor` from `shared/aiCostFactor.ts`, and route between providers with `ProviderRegistry` from `shared/providerRegistry.ts`.
5. Follow [contributing-apis.md](contributing-apis.md) for the puter.js method, types, docs, and tests.
