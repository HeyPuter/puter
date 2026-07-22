import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AI } from './index.js';

/**
 * Pins the exact `/drivers/call` wire payload every `puter.ai.*` call style
 * produces, by faking the network boundary (XMLHttpRequest / fetch). Every
 * documented and legacy argument shape is covered so the module can be
 * restructured without changing what apps observe on the wire.
 */

class FakeXHR {
    // Set per test: (parsedRequestBody) => driver-layer response object.
    static respondWith = null;
    // Set per test to simulate a non-2xx response.
    static statusOverride = null;
    static requests = [];

    _listeners = {};
    responseType = '';
    status = 200;

    open (method, url) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader (name, value) {
        (this.requestHeaders ??= {})[name] = value;
    }

    addEventListener (type, fn) {
        (this._listeners[type] ??= []).push(fn);
    }

    getResponseHeader (name) {
        return this._responseHeaders?.[name.toLowerCase()] ?? null;
    }

    send (body) {
        FakeXHR.requests.push(this);
        this.requestBody = body;
        this.status = FakeXHR.statusOverride ?? 200;
        const respObj = FakeXHR.respondWith
            ? FakeXHR.respondWith(body === null ? null : JSON.parse(body))
            : { success: true, result: {} };
        queueMicrotask(() => {
            const text = JSON.stringify(respObj);
            if ( this.responseType === 'blob' ) {
                this.response = new Blob([text], { type: 'application/json' });
                this._responseHeaders = { 'content-type': 'application/json' };
            } else {
                this.responseText = text;
            }
            for ( const fn of this._listeners.load ?? [] ) {
                fn.call(this, { target: this });
            }
        });
    }
}

const lastBody = () => JSON.parse(FakeXHR.requests.at(-1).requestBody);

const makeFakePuter = () => ({
    authToken: 'test-token',
    APIOrigin: 'https://api.test',
    appID: 'app-test',
    env: 'nodejs',
    drivers: {
        call: async () => ({ result: [] }),
    },
});

// Minimal FileReader for node: only what blobToDataUri / blob_to_url use.
class FakeFileReader {
    readAsDataURL (blob) {
        blob.arrayBuffer().then((buf) => {
            this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
            this.onload?.({ target: this });
            this.onloadend?.();
        });
    }
}

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;
const origAudio = globalThis.Audio;
const origFetch = globalThis.fetch;
const origFileReader = globalThis.FileReader;

let ai;
let fakePuter;

beforeEach(() => {
    FakeXHR.requests = [];
    FakeXHR.respondWith = null;
    FakeXHR.statusOverride = null;
    globalThis.XMLHttpRequest = FakeXHR;
    globalThis.Audio = class {
        constructor (src) {
            this.src = src;
        }
    };
    globalThis.FileReader = FakeFileReader;
    fakePuter = makeFakePuter();
    globalThis.puter = fakePuter;
    ai = new AI(fakePuter);
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
    globalThis.Audio = origAudio;
    globalThis.fetch = origFetch;
    globalThis.FileReader = origFileReader;
});

describe('ai.chat driver payloads', () => {
    it('chat(prompt) wraps the prompt in a single message', async () => {
        await ai.chat('hello');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-chat-completion',
            driver: 'ai-chat',
            method: 'complete',
            test_mode: false,
            auth_token: 'test-token',
        });
        expect(body.args).toEqual({ messages: [{ content: 'hello' }] });
    });

    it('chat(prompt, testMode) sets test_mode', async () => {
        await ai.chat('hello', true);
        expect(lastBody().test_mode).toBe(true);
        expect(lastBody().args).toEqual({ messages: [{ content: 'hello' }] });
    });

    it('chat(prompt, options, testMode) sets test_mode', async () => {
        await ai.chat('hello', { model: 'fake' }, true);
        expect(lastBody().test_mode).toBe(true);
        expect(lastBody().args.model).toBe('fake');
    });

    it('chat(prompt, options) forwards the known parameters', async () => {
        await ai.chat('hello', {
            model: 'model-1',
            temperature: 0.7,
            max_tokens: 42,
            stream: true,
            provider: 'openai',
            tools: [{ type: 'function' }],
            reasoning_effort: 'low',
            unknown_param: 'dropped',
        });
        expect(lastBody().args).toEqual({
            messages: [{ content: 'hello' }],
            model: 'model-1',
            temperature: 0.7,
            max_tokens: 42,
            stream: true,
            provider: 'openai',
            tools: [{ type: 'function' }],
            reasoning_effort: 'low',
        });
    });

    it('chat(prompt, imageURL) builds a vision request', async () => {
        await ai.chat('describe', 'https://example.com/cat.png');
        expect(lastBody().args).toEqual({
            vision: true,
            messages: [{
                content: [
                    'describe',
                    { image_url: { url: 'https://example.com/cat.png' } },
                ],
            }],
        });
    });

    it('chat(prompt, videoURL) builds a video_url block', async () => {
        await ai.chat('describe', 'https://example.com/cat.mp4');
        expect(lastBody().args.messages[0].content[1]).toEqual({
            video_url: { url: 'https://example.com/cat.mp4' },
        });
    });

    it('chat(prompt, [mediaURLs]) builds one block per URL', async () => {
        await ai.chat('describe', ['https://x.com/a.png', 'https://x.com/b.mp4']);
        expect(lastBody().args).toEqual({
            vision: true,
            messages: [{
                content: [
                    'describe',
                    { image_url: { url: 'https://x.com/a.png' } },
                    { video_url: { url: 'https://x.com/b.mp4' } },
                ],
            }],
        });
    });

    it('chat(messages, options) passes the array through', async () => {
        const messages = [
            { role: 'system', content: 'be brief' },
            { role: 'user', content: 'hi' },
        ];
        await ai.chat(messages, { model: 'model-2' });
        expect(lastBody().args).toEqual({ messages, model: 'model-2' });
    });

    it('chat maps the legacy driver option onto provider', async () => {
        await ai.chat('hello', { driver: 'openrouter' });
        expect(lastBody().args.provider).toBe('openrouter');
    });

    it('chat result stringifies to the message content', async () => {
        FakeXHR.respondWith = () => ({
            success: true,
            result: { message: { role: 'assistant', content: 'the answer' } },
        });
        const result = await ai.chat('question');
        expect(String(result)).toBe('the answer');
        expect(result.valueOf()).toBe('the answer');
    });
});

describe('ai.img2txt driver payloads', () => {
    it('img2txt(source) targets aws-textract by default', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: {} });
        await ai.img2txt('https://example.com/scan.png');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-ocr',
            driver: 'aws-textract',
            method: 'recognize',
            test_mode: false,
        });
        expect(body.args).toEqual({ source: 'https://example.com/scan.png' });
    });

    it('img2txt honors the mistral provider and strips it from args', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: {} });
        await ai.img2txt({ source: 'https://example.com/scan.png', provider: 'mistral' });
        const body = lastBody();
        expect(body.driver).toBe('mistral');
        expect(body.args).toEqual({ source: 'https://example.com/scan.png' });
    });

    it('img2txt(source, testMode) sets test_mode', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: {} });
        await ai.img2txt('https://example.com/scan.png', true);
        expect(lastBody().test_mode).toBe(true);
    });

    it('img2txt converts a Blob source to a data URI', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: {} });
        await ai.img2txt(new Blob(['fake-image-bytes'], { type: 'image/png' }));
        expect(lastBody().args.source).toMatch(/^data:/);
    });

    it('img2txt flattens textract blocks into text', async () => {
        FakeXHR.respondWith = () => ({
            success: true,
            result: {
                blocks: [
                    { type: 'text/textract:LINE', text: 'line one' },
                    { type: 'image/somethingelse', text: 'skipped' },
                    { type: 'text/textract:LINE', text: 'line two' },
                ],
            },
        });
        const text = await ai.img2txt('https://example.com/scan.png');
        expect(text).toBe('line one\nline two\n');
    });

    it('img2txt rejects without a source', async () => {
        await expect(ai.img2txt({})).rejects.toMatchObject({ code: 'source_required' });
    });
});

describe('ai.txt2speech driver payloads', () => {
    it('txt2speech(text) defaults to aws-polly with Joanna', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('hello world');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-tts',
            driver: 'aws-polly',
            method: 'synthesize',
            test_mode: false,
        });
        expect(body.args).toEqual({
            text: 'hello world',
            voice: 'Joanna',
            engine: 'standard',
            language: 'en-US',
        });
    });

    it('txt2speech supports legacy positional language/voice/engine', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('bonjour', 'fr-FR', 'Celine', 'neural');
        expect(lastBody().args).toEqual({
            text: 'bonjour',
            language: 'fr-FR',
            voice: 'Celine',
            engine: 'neural',
        });
    });

    it('txt2speech routes provider openai with its defaults', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('hello', { provider: 'openai' });
        const body = lastBody();
        expect(body.driver).toBe('openai-tts');
        expect(body.args).toEqual({
            text: 'hello',
            provider: 'openai',
            voice: 'alloy',
            model: 'gpt-4o-mini-tts',
            response_format: 'mp3',
        });
    });

    it('txt2speech routes provider elevenlabs with its defaults', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('hello', { provider: 'elevenlabs' });
        const body = lastBody();
        expect(body.driver).toBe('elevenlabs-tts');
        expect(body.args).toEqual({
            text: 'hello',
            provider: 'elevenlabs',
            voice: '21m00Tcm4TlvDq8ikWAM',
            model: 'eleven_multilingual_v2',
            output_format: 'mp3_44100_128',
        });
    });

    it('txt2speech infers the provider from engine aliases', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('hello', { engine: 'gemini' });
        const body = lastBody();
        expect(body.driver).toBe('gemini-tts');
        // Long-standing quirk: the engine alias is carried over as the model.
        expect(body.args).toEqual({
            text: 'hello',
            voice: 'Kore',
            model: 'gemini',
        });
    });

    it('txt2speech(text, testMode) sets test_mode', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.txt2speech('hello', true);
        expect(lastBody().test_mode).toBe(true);
    });

    it('txt2speech resolves to an audio object exposing the URL', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        const audio = await ai.txt2speech('hello');
        expect(audio.src).toBe('data:audio/mpeg;base64,QUJD');
        expect(audio.toString()).toBe('data:audio/mpeg;base64,QUJD');
    });

    it('txt2speech rejects when text is missing', async () => {
        await expect(ai.txt2speech()).rejects.toMatchObject({ code: 'text_required' });
    });

    it('txt2speech rejects text over the size limit', async () => {
        await expect(ai.txt2speech('a'.repeat(3001)))
            .rejects.toMatchObject({ code: 'input_too_large' });
    });

    it('txt2speech rejects an invalid aws engine', async () => {
        await expect(ai.txt2speech('hello', { engine: 'bogus' }))
            .rejects.toMatchObject({ code: 'invalid_engine' });
    });

    it('txt2speech rejects an invalid second argument', async () => {
        await expect(ai.txt2speech('hello', 123))
            .rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('txt2speech.listEngines defaults to aws-polly', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
        await ai.txt2speech.listEngines();
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-tts',
            driver: 'aws-polly',
            method: 'list_engines',
        });
        expect(body.args).toEqual({});
    });

    it('txt2speech.listEngines routes to the named provider', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
        await ai.txt2speech.listEngines({ provider: 'openai' });
        const body = lastBody();
        expect(body.driver).toBe('openai-tts');
        expect(body.args).toEqual({ provider: 'openai' });
    });

    it('txt2speech.listVoices(engine) filters by engine', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
        await ai.txt2speech.listVoices('neural');
        const body = lastBody();
        expect(body).toMatchObject({ driver: 'aws-polly', method: 'list_voices' });
        expect(body.args).toEqual({ engine: 'neural' });
    });
});

describe('ai.speech2txt driver payloads', () => {
    it('speech2txt(dataURI) transcribes via openai by default', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { text: 'hi' } });
        await ai.speech2txt('data:audio/mpeg;base64,QUJD');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-speech2txt',
            driver: 'openai-speech2txt',
            method: 'transcribe',
            test_mode: false,
        });
        expect(body.args).toEqual({ file: 'data:audio/mpeg;base64,QUJD' });
    });

    it('speech2txt maps audio onto file and honors translate + provider', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { text: 'hi' } });
        await ai.speech2txt({
            audio: 'data:audio/mpeg;base64,QUJD',
            translate: true,
            provider: 'xai',
        });
        const body = lastBody();
        expect(body.driver).toBe('xai-speech2txt');
        expect(body.method).toBe('translate');
        expect(body.args).toEqual({ file: 'data:audio/mpeg;base64,QUJD' });
    });

    it('speech2txt returns bare text for response_format text', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { text: 'transcribed' } });
        const out = await ai.speech2txt({
            file: 'data:audio/mpeg;base64,QUJD',
            response_format: 'text',
        });
        expect(out).toBe('transcribed');
    });

    it('speech2txt rejects without arguments', async () => {
        await expect(ai.speech2txt()).rejects.toMatchObject({ code: 'arguments_required' });
    });
});

describe('ai.speech2speech driver payloads', () => {
    it('speech2speech normalizes camelCase options into snake_case', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        await ai.speech2speech({
            audio: 'data:audio/mpeg;base64,QUJD',
            voiceId: 'voice-1',
            outputFormat: 'mp3_44100_128',
            removeBackgroundNoise: true,
        });
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-speech2speech',
            driver: 'elevenlabs-voice-changer',
            method: 'convert',
            test_mode: false,
        });
        expect(body.args).toEqual({
            audio: 'data:audio/mpeg;base64,QUJD',
            voice: 'voice-1',
            output_format: 'mp3_44100_128',
            remove_background_noise: true,
        });
    });

    it('speech2speech resolves to an audio object exposing the URL', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:audio/mpeg;base64,QUJD' });
        const audio = await ai.speech2speech({ audio: 'data:audio/mpeg;base64,QUJD' });
        expect(audio.src).toBe('data:audio/mpeg;base64,QUJD');
        expect(audio.toString()).toBe('data:audio/mpeg;base64,QUJD');
    });

    it('speech2speech rejects without audio', async () => {
        await expect(ai.speech2speech({ voiceId: 'voice-1' }))
            .rejects.toMatchObject({ code: 'audio_required' });
    });
});

describe('ai.txt2img driver payloads', () => {
    it('txt2img(prompt) targets the ai-image driver', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:image/png;base64,QUJD' });
        await ai.txt2img('a cat');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-image-generation',
            driver: 'ai-image',
            method: 'generate',
            test_mode: false,
        });
        expect(body.args).toEqual({ prompt: 'a cat' });
    });

    it('txt2img(prompt, testMode) sets test_mode', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:image/png;base64,QUJD' });
        await ai.txt2img('a cat', true);
        expect(lastBody().test_mode).toBe(true);
    });

    it('txt2img expands the nano-banana model aliases', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:image/png;base64,QUJD' });
        await ai.txt2img({ prompt: 'a cat', model: 'nano-banana' });
        expect(lastBody().args.model).toBe('gemini-2.5-flash-image-preview');
    });

    it('txt2img honors an explicit driver hint', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:image/png;base64,QUJD' });
        await ai.txt2img({ prompt: 'a cat', driver: 'openai-image-generation' });
        const body = lastBody();
        expect(body.driver).toBe('openai-image-generation');
        expect(body.args).toEqual({ prompt: 'a cat', driver: 'openai-image-generation' });
    });

    it('txt2img resolves to an image object exposing the URL', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'data:image/png;base64,QUJD' });
        const img = await ai.txt2img('a cat');
        expect(img.src).toBe('data:image/png;base64,QUJD');
        expect(img.toString()).toBe('data:image/png;base64,QUJD');
    });
});

describe('ai.txt2vid driver payloads', () => {
    it('txt2vid(prompt) targets the ai-video driver', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'https://cdn.test/video.mp4' });
        await ai.txt2vid('a sunset');
        const body = lastBody();
        expect(body).toMatchObject({
            interface: 'puter-video-generation',
            driver: 'ai-video',
            method: 'generate',
            test_mode: false,
        });
        expect(body.args).toEqual({ prompt: 'a sunset' });
    });

    it('txt2vid maps duration onto seconds', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'https://cdn.test/video.mp4' });
        await ai.txt2vid({ prompt: 'a sunset', duration: 6 });
        expect(lastBody().args).toEqual({ prompt: 'a sunset', duration: 6, seconds: 6 });
    });

    it('txt2vid resolves to a video object exposing the URL', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'https://cdn.test/video.mp4' });
        const video = await ai.txt2vid('a sunset');
        expect(video.src).toBe('https://cdn.test/video.mp4');
        expect(video.toString()).toBe('https://cdn.test/video.mp4');
    });

    it('txt2vid rejects without a prompt', async () => {
        await expect(ai.txt2vid({})).rejects.toMatchObject({ code: 'prompt_required' });
    });
});

describe('instance isolation', () => {
    it('driver calls use the constructor instance, not globalThis.puter', async () => {
        globalThis.puter = {
            ...makeFakePuter(),
            authToken: 'global-token',
            APIOrigin: 'https://global.test',
        };
        await ai.chat('hello');
        const request = FakeXHR.requests.at(-1);
        expect(request.url).toBe('https://api.test/drivers/call');
        expect(JSON.parse(request.requestBody).auth_token).toBe('test-token');
    });
});

describe('ai.listModels', () => {
    it('fetches the public models endpoint with the auth token', async () => {
        FakeXHR.respondWith = () => ({
            models: [
                { id: 'm1', provider: 'p1' },
                { id: 'm2', provider: 'p2' },
            ],
        });
        const models = await ai.listModels('p2');
        const request = FakeXHR.requests.at(-1);
        expect(request.method).toBe('GET');
        expect(request.url).toBe('https://api.test/puterai/chat/models/details');
        expect(request.requestHeaders).toEqual({ Authorization: 'Bearer test-token' });
        expect(models).toEqual([{ id: 'm2', provider: 'p2' }]);
    });

    it('falls back to the driver call when the endpoint fails', async () => {
        FakeXHR.statusOverride = 500;
        let driverCallArgs;
        fakePuter.drivers.call = async (...args) => {
            driverCallArgs = args;
            return { result: [{ id: 'm1', provider: 'p1' }] };
        };
        const models = await ai.listModels();
        expect(driverCallArgs).toEqual(['puter-chat-completion', 'ai-chat', 'models']);
        expect(models).toEqual([{ id: 'm1', provider: 'p1' }]);
    });

    it('listModelProviders deduplicates providers', async () => {
        FakeXHR.respondWith = () => ({
            models: [
                { id: 'a', provider: 'p1' },
                { id: 'b', provider: 'p2' },
                { id: 'c', provider: 'p1' },
            ],
        });
        const providers = await ai.listModelProviders();
        expect(providers).toEqual(['p1', 'p2']);
    });
});
