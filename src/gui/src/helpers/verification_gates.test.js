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
    runVerificationGates,
    with_verification_gate,
} = await import('./verification_gates.js');
const { default: emailGate } = await import('../UI/UIWindowEmailConfirmationRequired.js');
const { default: cardGate } = await import('../UI/UIWindowCardVerificationRequired.js');

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
        // Read once before opening; nothing after backing out.
        expect(window.refresh_user_data).toHaveBeenCalledTimes(1);
    });

    test('reads the account before opening, so the window sees a gate set mid-session', async () => {
        const order = [];
        window.refresh_user_data = vi.fn(async () => order.push('refresh'));
        phoneGate.mockImplementationOnce(async () => order.push('window') && false);
        await openVerificationGateWindow('phone_verification_required');
        expect(order).toEqual(['refresh', 'window']);
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

describe('runVerificationGates', () => {
    const track = () => {
        const order = [];
        emailGate.mockImplementation(async () => order.push('email') > 0);
        phoneGate.mockImplementation(async () => order.push('phone') > 0);
        cardGate.mockImplementation(async () => order.push('card') > 0);
        return order;
    };
    const all = { requires_phone_verification: true, requires_card_verification: true };

    test('runs email, phone, then card', async () => {
        const order = track();
        await expect(runVerificationGates(all, true, false, false)).resolves.toBe(true);
        expect(order).toEqual(['email', 'phone', 'card']);
    });

    test('runs the email last for an account that clears it last', async () => {
        const order = track();
        await runVerificationGates({ ...all, email_gate_last: true }, true, false, false);
        expect(order).toEqual(['card', 'phone', 'email']);
    });

    test('asks for a card the phone step added when the card gate already ran', async () => {
        const order = track();
        globalThis.puter = { os: { user: vi.fn(async () => ({ requires_card_verification: true })) } };
        try {
            await runVerificationGates({ requires_phone_verification: true, email_gate_last: true }, true, false, false);
        } finally {
            delete globalThis.puter;
        }
        expect(order).toEqual(['phone', 'card', 'email']);
    });

    test('skips the email when not asked, and the card when the phone fallback cleared it', async () => {
        const order = track();
        phoneGate.mockImplementationOnce(async () => order.push('phone') && 'card');
        await runVerificationGates({ ...all, card_fallback_available: true }, false, false, false);
        expect(order).toEqual(['phone']);
        expect(phoneGate.mock.calls[0][0].card_fallback_available).toBe(true);
    });

    test('reopens the phone window until it is cleared', async () => {
        phoneGate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await runVerificationGates({ requires_phone_verification: true }, false, false, true);
        expect(phoneGate).toHaveBeenCalledTimes(2);
        expect(phoneGate.mock.calls[0][0].window_options).toEqual({ cover_page: true, has_head: false });
    });

    test('skips a gate the one before it cleared, reading the account again in between', async () => {
        const order = track();
        globalThis.puter = { os: { user: vi.fn(async () => ({ requires_phone_verification: false })) } };
        try {
            await runVerificationGates({ requires_phone_verification: true, phone_on_file: '42' }, true, false, false);
        } finally {
            delete globalThis.puter;
        }
        expect(order).toEqual(['email']);
    });

    test('tells the phone window which number is on file', async () => {
        track();
        await runVerificationGates({ requires_phone_verification: true, phone_on_file: '42' }, false, false, false);
        expect(phoneGate.mock.calls[0][0].phone_on_file).toBe('42');
    });

    test('reports an email the user did not confirm', async () => {
        emailGate.mockResolvedValue(false);
        await expect(runVerificationGates({}, true, false, false)).resolves.toBe(false);
    });
});
