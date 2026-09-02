import { beforeEach, describe, expect, test, vi } from 'vitest';

const phoneGate = vi.fn();
vi.mock('../UI/UIWindowPhoneVerificationRequired.js', () => ({
    default: (...args) => phoneGate(...args),
}));
vi.mock('../UI/UIWindowEmailConfirmationRequired.js', () => ({
    default: vi.fn(),
}));
vi.mock('../UI/UIWindowCardVerificationRequired.js', () => ({
    default: vi.fn(),
}));

const { openVerificationGateWindow } = await import('./verification_gates.js');

beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window = {
        auth_token: 'tok',
        refresh_user_data: vi.fn(async () => {}),
    };
});

describe('openVerificationGateWindow', () => {
    test('unknown codes resolve false without opening anything', async () => {
        await expect(openVerificationGateWindow('nope')).resolves.toBe(false);
        expect(phoneGate).not.toHaveBeenCalled();
    });

    test('resolves true and refreshes user data once the gate clears', async () => {
        phoneGate.mockResolvedValueOnce(true);
        await expect(
            openVerificationGateWindow('phone_verification_required'),
        ).resolves.toBe(true);
        expect(window.refresh_user_data).toHaveBeenCalledWith('tok');
    });

    test("the phone gate's 'card' resolution counts as cleared", async () => {
        phoneGate.mockResolvedValueOnce('card');
        await expect(
            openVerificationGateWindow('phone_verification_required'),
        ).resolves.toBe(true);
    });

    test('concurrent callers share one window', async () => {
        let settle;
        phoneGate.mockReturnValueOnce(
            new Promise((resolve) => {
                settle = resolve;
            }),
        );
        const first = openVerificationGateWindow('phone_verification_required');
        const second = openVerificationGateWindow('phone_verification_required');
        settle(true);
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(phoneGate).toHaveBeenCalledTimes(1);
    });

    test('a dialog failure resolves false and releases the single-flight', async () => {
        phoneGate.mockRejectedValueOnce(new Error('boom'));
        await expect(
            openVerificationGateWindow('phone_verification_required'),
        ).resolves.toBe(false);
        phoneGate.mockResolvedValueOnce(true);
        await expect(
            openVerificationGateWindow('phone_verification_required'),
        ).resolves.toBe(true);
    });
});
