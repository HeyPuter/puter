import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from './notify.js';
import { driverCall } from '../../lib/networkUtils.js';

vi.mock('../../lib/networkUtils.js', () => ({ driverCall: vi.fn() }));

beforeEach(() => {
    vi.mocked(driverCall).mockReset().mockResolvedValue({ uid: 'n-1' });
});

describe('notify priority', () => {
    it.each([
        {},
        { to: { handle: 'share-handle' } },
        { sendAt: 1_800_000_000_000 },
        { to: { handle: 'share-handle' }, sendAt: 1_800_000_000_000 },
    ])('forwards high priority with %j', async (options) => {
        await notify.call(
            { puter: {} },
            {
                title: 'Incoming call',
                priority: 'high',
                ttl: 30,
                ...options,
            },
        );
        expect(driverCall).toHaveBeenCalledWith(
            expect.objectContaining({
                args: {
                    object: {
                        value: {
                            type: 'app.message',
                            title: 'Incoming call',
                            priority: 'high',
                            ttl: 30,
                            ...options,
                        },
                    },
                },
            }),
        );
    });
});
