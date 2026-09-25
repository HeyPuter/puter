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

const {
    is_verification_gate_error,
    openVerificationGateWindow,
    with_verification_gate,
} = await import('./verification_gates.js');

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

describe('openVerificationGateWindow with factors', () => {
    test('the account gate cannot be dismissed', async () => {
        phoneGate.mockResolvedValueOnce(true);
        await openVerificationGateWindow('phone_verification_required');
        expect(phoneGate).toHaveBeenCalledWith(
            expect.objectContaining({ show_close_button: false, logout_in_footer: true }),
        );
    });

    test('a factor gate is a step the user may back out of', async () => {
        phoneGate.mockResolvedValueOnce(false);
        await expect(
            openVerificationGateWindow('phone_verification_required', { factors: ['phone'] }),
        ).resolves.toBe(false);
        const [options] = phoneGate.mock.calls[0];
        expect(options.show_close_button).toBeUndefined();
        expect(options.logout_in_footer).toBeUndefined();
        expect(options.card_alternative).toBe(false);
        expect(window.refresh_user_data).not.toHaveBeenCalled();
    });

    test('offers the card alongside when the server accepts either', async () => {
        phoneGate.mockResolvedValueOnce('card');
        await expect(
            openVerificationGateWindow('phone_verification_required', {
                factors: ['phone', 'card'],
            }),
        ).resolves.toBe(true);
        expect(phoneGate).toHaveBeenCalledWith(
            expect.objectContaining({ card_alternative: true }),
        );
    });
});

describe('with_verification_gate', () => {
    const gate_error = {
        code: 'phone_verification_required',
        message: 'Please verify your phone number to continue',
        factors: ['phone', 'card'],
    };

    test('passes a result straight through', async () => {
        await expect(with_verification_gate(async () => 'ok')).resolves.toBe('ok');
        expect(phoneGate).not.toHaveBeenCalled();
    });

    test('rethrows anything that is not a gate', async () => {
        const other = { code: 'forbidden' };
        await expect(with_verification_gate(async () => { throw other; })).rejects.toBe(other);
        expect(is_verification_gate_error(other)).toBe(false);
        expect(phoneGate).not.toHaveBeenCalled();
    });

    test('opens the gate with the factors and runs again once cleared', async () => {
        phoneGate.mockResolvedValueOnce(true);
        const fn = vi.fn()
            .mockRejectedValueOnce(gate_error)
            .mockResolvedValueOnce('shared');
        await expect(with_verification_gate(fn)).resolves.toBe('shared');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(phoneGate).toHaveBeenCalledWith(
            expect.objectContaining({ card_alternative: true }),
        );
    });

    test('rethrows the refusal when the user backs out', async () => {
        phoneGate.mockResolvedValueOnce(false);
        const fn = vi.fn().mockRejectedValue(gate_error);
        await expect(with_verification_gate(fn)).rejects.toBe(gate_error);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('does not loop when the second run is refused too', async () => {
        phoneGate.mockResolvedValue(true);
        const fn = vi.fn().mockRejectedValue(gate_error);
        await expect(with_verification_gate(fn)).rejects.toBe(gate_error);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(phoneGate).toHaveBeenCalledTimes(1);
    });
});
