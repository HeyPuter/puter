import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConvoMicrophone, ConvoSpeaker } from './convoMedia.js';

class FakeContext {
    static instances = [];
    state = 'running';
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: vi.fn(async () => {}) };
    nodes = [];
    constructor() {
        FakeContext.instances.push(this);
    }
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {
        this.state = 'closed';
    });
    createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
    }
    createBuffer(channels, length) {
        return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
        const node = {
            buffer: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        };
        this.nodes.push(node);
        return node;
    }
}
class FakeWorklet {
    static instances = [];
    port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
    constructor() {
        FakeWorklet.instances.push(this);
    }
    connect = vi.fn();
    disconnect = vi.fn();
}
const makeConvo = () => ({
    state: 'connected',
    assertConnected() {
        if (this.state !== 'connected') throw { code: 'session_closed' };
    },
    appendAudio: vi.fn(),
    reportMediaError: vi.fn(),
    interrupt: vi.fn(async () => {}),
});
const track = () => ({ enabled: true, stop: vi.fn() });
let helpers;
beforeEach(() => {
    helpers = [];
    FakeContext.instances = [];
    FakeWorklet.instances = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorklet);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(async () => {
    for (const helper of helpers) await helper.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('captures PCM, acknowledges bounded worklet chunks, mutes and releases tracks', async () => {
    const c = makeConvo();
    const audioTrack = track();
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: vi.fn(async () => ({
                getTracks: () => [audioTrack],
                getAudioTracks: () => [audioTrack],
            })),
        },
    });
    const mic = new ConvoMicrophone(c);
    helpers.push(mic);
    const pending = mic.start();
    expect(mic.start()).toBe(pending);
    await pending;
    const node = FakeWorklet.instances[0];
    const pcm = new Int16Array(480);
    node.port.onmessage({ data: { pcm } });
    expect(c.appendAudio).toHaveBeenCalledWith(pcm);
    expect(node.port.postMessage).toHaveBeenCalledWith('ack');
    mic.mute();
    node.port.onmessage({ data: { pcm } });
    expect(c.appendAudio).toHaveBeenCalledOnce();
    expect(audioTrack.enabled).toBe(false);
    mic.unmute();
    expect(audioTrack.enabled).toBe(true);
    mic.stop();
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(node.port.close).toHaveBeenCalled();
    expect(FakeContext.instances[0].close).toHaveBeenCalled();
});
it('releases a stream when permission resolves after stop', async () => {
    let grant;
    const audioTrack = track();
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: () =>
                new Promise((resolve) => {
                    grant = resolve;
                }),
        },
    });
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    const pending = mic.start();
    mic.stop();
    grant({ getTracks: () => [audioTrack] });
    await expect(pending).rejects.toMatchObject({ code: 'session_closed' });
    expect(audioTrack.stop).toHaveBeenCalled();
});
it('drops chunks under backpressure or while reconnecting, and stops on other errors', async () => {
    const c = makeConvo();
    const audioTrack = track();
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: async () => ({ getTracks: () => [audioTrack] }),
        },
    });
    const mic = new ConvoMicrophone(c);
    helpers.push(mic);
    await mic.start();
    const port = FakeWorklet.instances[0].port;
    const pcm = new Int16Array(480);
    c.appendAudio.mockImplementationOnce(() => {
        throw { code: 'queue_full', message: 'full' };
    });
    port.onmessage({ data: { pcm } });
    expect(audioTrack.stop).not.toHaveBeenCalled();
    c.state = 'connecting';
    port.onmessage({ data: { pcm } });
    expect(c.appendAudio).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledTimes(2);
    c.state = 'connected';
    c.appendAudio.mockImplementationOnce(() => {
        throw { code: 'session_closed', message: 'closed' };
    });
    port.onmessage({ data: { pcm } });
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(c.reportMediaError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'session_closed' }),
    );
});
it('captures at the device rate', async () => {
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: async () => ({ getTracks: () => [track()] }),
        },
    });
    const ContextSpy = vi.fn(function (options) {
        this.options = options;
        return new FakeContext();
    });
    vi.stubGlobal('AudioContext', ContextSpy);
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    await mic.start();
    expect(ContextSpy).toHaveBeenCalledWith(undefined);
});
it('reports a denied permission', async () => {
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: async () => {
                throw Object.assign(new Error('denied'), {
                    name: 'NotAllowedError',
                });
            },
        },
    });
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    await expect(mic.start()).rejects.toMatchObject({
        code: 'permission_denied',
    });
});
it('rejects unsupported capture environments', async () => {
    vi.stubGlobal('navigator', {});
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    await expect(mic.start()).rejects.toMatchObject({
        code: 'unsupported_environment',
    });
});
it('waits on the permission prompt but times out a stuck audio context', async () => {
    vi.useFakeTimers();
    let grant;
    const audioTrack = track();
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: () =>
                new Promise((resolve) => {
                    grant = resolve;
                }),
        },
    });
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    const result = expect(mic.start()).rejects.toMatchObject({
        code: 'media_timeout',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    FakeContext.instances[0].resume = vi.fn(() => new Promise(() => {}));
    grant({ getTracks: () => [audioTrack] });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(audioTrack.stop).toHaveBeenCalled();
});
it('tracks played position and clears playback immediately', async () => {
    const speaker = new ConvoSpeaker(makeConvo());
    helpers.push(speaker);
    await speaker.start();
    speaker.enqueue(new Int16Array(2400), {
        type: 'response.output_audio.delta',
        item_id: 'item',
        response_id: 'r',
        content_index: 0,
    });
    const context = FakeContext.instances[0];
    context.currentTime = 0.05;
    expect(speaker.playbackPosition()).toEqual({
        itemId: 'item',
        contentIndex: 0,
        playedMs: 50,
    });
    expect(speaker.bargeIn).toBe(true);
    expect(speaker.responseId).toBe('r');
    speaker.clearPlayback();
    expect(context.nodes[0].stop).toHaveBeenCalled();
    expect(speaker.playbackPosition()).toBeUndefined();
    await speaker.stop();
    expect(context.close).toHaveBeenCalled();
});
it('bounds scheduled playback without interrupting the reply', async () => {
    const c = makeConvo();
    const speaker = new ConvoSpeaker(c);
    helpers.push(speaker);
    await speaker.start({ bargeIn: false });
    const delta = {
        type: 'response.output_audio.delta',
        item_id: 'item',
        response_id: 'r',
        content_index: 0,
    };
    // Fifteen seconds arriving at once plays in full.
    for (let i = 0; i < 15; i++) speaker.enqueue(new Int16Array(24000), delta);
    expect(FakeContext.instances[0].nodes).toHaveLength(15);
    expect(c.reportMediaError).not.toHaveBeenCalled();
    for (let i = 0; i < 300; i++) speaker.enqueue(new Int16Array(24000), delta);
    expect(FakeContext.instances[0].nodes).toHaveLength(300);
    expect(c.interrupt).not.toHaveBeenCalled();
    expect(c.reportMediaError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ code: 'queue_full' }),
    );
    expect(speaker.bargeIn).toBe(false);
});
it('subtracts output latency and covers gaps between chunks', async () => {
    const speaker = new ConvoSpeaker(makeConvo());
    helpers.push(speaker);
    await speaker.start();
    const context = FakeContext.instances[0];
    context.outputLatency = 0.2;
    speaker.enqueue(new Int16Array(24000), {
        type: 'response.output_audio.delta',
        item_id: 'item',
        response_id: 'r',
        content_index: 0,
    });
    context.currentTime = 0.5;
    expect(speaker.playbackPosition('r')).toMatchObject({ playedMs: 300 });
    // The chunk finished and the next hasn't arrived.
    context.nodes[0].onended();
    context.currentTime = 1.5;
    expect(speaker.playbackPosition('r')).toEqual({
        itemId: 'item',
        contentIndex: 0,
        playedMs: 1000,
    });
    expect(speaker.playbackPosition('other')).toBeUndefined();
});

it('a late canceled permission request does not stop a newer capture', async () => {
    let grantFirst;
    const oldTrack = track();
    const newTrack = track();
    let requests = 0;
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: () =>
                ++requests === 1
                    ? new Promise((resolve) => {
                          grantFirst = resolve;
                      })
                    : Promise.resolve({ getTracks: () => [newTrack] }),
        },
    });
    const mic = new ConvoMicrophone(makeConvo());
    helpers.push(mic);
    const oldStart = mic.start();
    mic.stop();
    await mic.start();
    grantFirst({ getTracks: () => [oldTrack] });
    await expect(oldStart).rejects.toMatchObject({ code: 'session_closed' });
    expect(oldTrack.stop).toHaveBeenCalled();
    expect(newTrack.stop).not.toHaveBeenCalled();
});
