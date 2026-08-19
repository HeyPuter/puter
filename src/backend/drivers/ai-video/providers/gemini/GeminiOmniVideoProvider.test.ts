/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Offline unit tests for GeminiOmniVideoProvider.
 *
 * Boots a real PuterServer so the affordability gate and metering run against
 * the live MeteringService, and mocks @google/genai at the network boundary.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { PuterServer } from '../../../../server.js';
import { setupTestServer } from '../../../../testUtil.js';
import { withTestActor } from '../../../integrationTestUtil.js';
import { GeminiOmniVideoProvider } from './GeminiOmniVideoProvider.js';

const { createMock, getMock, deleteMock, filesGetMock } = vi.hoisted(() => ({
    createMock: vi.fn(),
    getMock: vi.fn(),
    deleteMock: vi.fn(),
    filesGetMock: vi.fn(),
}));

vi.mock('@google/genai', () => {
    const GoogleGenAI = vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
    ) {
        this.interactions = {
            create: createMock,
            get: getMock,
            delete: deleteMock,
        };
        this.files = { get: filesGetMock };
    });
    return { GoogleGenAI };
});

let server: PuterServer;
let remainingUsageSpy: MockInstance<MeteringService['getRemainingUsage']>;
let recordSpy: MockInstance<MeteringService['utilRecordUsageObject']>;

const AMPLE_CREDIT = 100_000_000_000;
const VIDEO_URI =
    'https://generativelanguage.googleapis.com/v1beta/files/abc123:download';

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const makeProvider = () =>
    new GeminiOmniVideoProvider(
        { apiKey: 'test-key' },
        server.services.metering,
    );

const completed = (overrides: Record<string, unknown> = {}) => ({
    id: 'int_omni_1',
    created: '2026-08-19T00:00:00Z',
    updated: '2026-08-19T00:00:30Z',
    status: 'completed',
    model: 'gemini-omni-flash-preview',
    outputs: [{ type: 'video', mime_type: 'video/mp4', uri: VIDEO_URI }],
    usage: {
        total_input_tokens: 20,
        total_output_tokens: 46_336,
        output_tokens_by_modality: [{ modality: 'video', tokens: 46_336 }],
    },
    ...overrides,
});

beforeEach(() => {
    createMock.mockReset();
    getMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    filesGetMock.mockReset().mockResolvedValue({ state: 'ACTIVE' });
    remainingUsageSpy = vi.spyOn(server.services.metering, 'getRemainingUsage');
    remainingUsageSpy.mockResolvedValue(AMPLE_CREDIT);
    recordSpy = vi.spyOn(server.services.metering, 'utilRecordUsageObject');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('validation', () => {
    it('rejects an empty prompt before reaching the upstream', async () => {
        await expect(
            withTestActor(() => makeProvider().generate({ prompt: '   ' })),
        ).rejects.toThrow(/non-empty/);
        expect(createMock).not.toHaveBeenCalled();
    });

    it('short-circuits test_mode without spending credit', async () => {
        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', test_mode: true }),
        );
        expect(result).toBe('https://assets.puter.site/txt2vid.mp4');
        expect(createMock).not.toHaveBeenCalled();
        expect(recordSpy).not.toHaveBeenCalled();
    });
});

describe('request shaping', () => {
    it('asks for a text_to_video interaction with uri delivery', async () => {
        createMock.mockResolvedValue(completed());

        await withTestActor(() =>
            makeProvider().generate({ prompt: 'a marble rolling' }),
        );

        expect(createMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gemini-omni-flash-preview',
                input: [{ type: 'text', text: 'a marble rolling' }],
                response_format: {
                    type: 'video',
                    aspect_ratio: '16:9',
                    delivery: 'uri',
                },
                generation_config: { video_config: { task: 'text_to_video' } },
            }),
        );
    });

    it('switches to image_to_video when a first frame is supplied', async () => {
        createMock.mockResolvedValue(completed());

        await withTestActor(() =>
            makeProvider().generate({
                prompt: 'animate this',
                input_reference: 'data:image/png;base64,QUJD',
            }),
        );

        const params = createMock.mock.calls[0][0];
        expect(params.generation_config.video_config.task).toBe(
            'image_to_video',
        );
        expect(params.input).toContainEqual({
            type: 'image',
            data: 'QUJD',
            mime_type: 'image/png',
        });
    });

    it('maps a portrait size to a 9:16 aspect ratio', async () => {
        createMock.mockResolvedValue(completed());

        await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi', size: '720x1280' }),
        );

        expect(createMock.mock.calls[0][0].response_format.aspect_ratio).toBe(
            '9:16',
        );
    });
});

describe('completion', () => {
    it('returns the video uri once the file is active', async () => {
        createMock.mockResolvedValue(completed());

        const result = await withTestActor(() =>
            makeProvider().generate({ prompt: 'hi' }),
        );

        expect(result).toBe(VIDEO_URI);
        expect(filesGetMock).toHaveBeenCalledWith({ name: 'files/abc123' });
    });

    it('waits for a file that is still processing', async () => {
        vi.useFakeTimers();
        try {
            createMock.mockResolvedValue(completed());
            filesGetMock
                .mockResolvedValueOnce({ state: 'PROCESSING' })
                .mockResolvedValueOnce({ state: 'ACTIVE' });

            const promise = withTestActor(() =>
                makeProvider().generate({ prompt: 'hi' }),
            );
            await vi.advanceTimersByTimeAsync(2_000);

            expect(await promise).toBe(VIDEO_URI);
            expect(filesGetMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('polls an in-progress interaction to completion', async () => {
        vi.useFakeTimers();
        try {
            createMock.mockResolvedValue(
                completed({ status: 'in_progress', outputs: [], usage: {} }),
            );
            getMock.mockResolvedValue(completed());

            const promise = withTestActor(() =>
                makeProvider().generate({ prompt: 'hi' }),
            );
            await vi.advanceTimersByTimeAsync(10_000);

            expect(await promise).toBe(VIDEO_URI);
            expect(getMock).toHaveBeenCalledWith('int_omni_1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns inline bytes as a data url', async () => {
        createMock.mockResolvedValue(
            completed({
                outputs: [
                    { type: 'video', mime_type: 'video/mp4', data: 'QUJD' },
                ],
            }),
        );

        expect(
            await withTestActor(() =>
                makeProvider().generate({ prompt: 'hi' }),
            ),
        ).toBe('data:video/mp4;base64,QUJD');
        expect(filesGetMock).not.toHaveBeenCalled();
    });

    it('raises when the interaction produced no video', async () => {
        createMock.mockResolvedValue(completed({ outputs: [] }));

        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toThrow(/did not include a video/);
    });

    it('deletes the stored interaction once the output is collected', async () => {
        createMock.mockResolvedValue(completed());

        await withTestActor(() => makeProvider().generate({ prompt: 'hi' }));

        expect(deleteMock).toHaveBeenCalledWith('int_omni_1');
    });

    it('does not fail a generated video over a cleanup error', async () => {
        createMock.mockResolvedValue(completed());
        deleteMock.mockRejectedValue(new Error('gone'));

        expect(
            await withTestActor(() =>
                makeProvider().generate({ prompt: 'hi' }),
            ),
        ).toBe(VIDEO_URI);
    });
});

describe('credit', () => {
    it('rejects up front when the worst-case clip is unaffordable', async () => {
        // 8s x 5792 tokens/s x 1750 micro-cents/token ~= $0.81.
        remainingUsageSpy.mockResolvedValue(1_000_000);

        await expect(
            withTestActor(() => makeProvider().generate({ prompt: 'hi' })),
        ).rejects.toThrow(/Insufficient funds/);
        expect(createMock).not.toHaveBeenCalled();
    });

    it('bills video output at the video rate', async () => {
        createMock.mockResolvedValue(completed());

        await withTestActor(() => makeProvider().generate({ prompt: 'hi' }));

        expect(recordSpy).toHaveBeenCalledWith(
            { prompt_tokens: 20, completion_tokens: 0, video_tokens: 46_336 },
            expect.anything(),
            'gemini:gemini-omni-flash-preview',
            expect.objectContaining({ video_tokens: 46_336 * 1750 }),
        );
    });

    it('bills an unbroken-down output as video rather than as text', async () => {
        createMock.mockResolvedValue(
            completed({
                usage: { total_input_tokens: 5, total_output_tokens: 1_000 },
            }),
        );

        await withTestActor(() => makeProvider().generate({ prompt: 'hi' }));

        expect(recordSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                video_tokens: 1_000,
                completion_tokens: 0,
            }),
            expect.anything(),
            expect.any(String),
            expect.anything(),
        );
    });
});
