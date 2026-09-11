import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stubbed down to the element the submit handler binds to.
const state = vi.hoisted(() => ({ el: null, closed: 0 }));

vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        state.el = { body: opts.body_content, opts };
        return state.el;
    }),
}));

vi.mock('../helpers/checkPasswordStrength.js', () => ({
    default: vi.fn((pw) => ({ overallPass: pw !== 'weak' })),
}));

globalThis.i18n = (key) => key;
globalThis.html_encode = (value) => String(value);

/** Minimal jQuery stand-in: a selector -> value map drives the handler. */
const fields = {};
let submitHandler = null;
globalThis.$ = () => ({
    find: (sel) => ({
        val: () => fields[sel],
        on: (evt, fn) => {
            if (evt === 'submit') submitHandler = fn;
        },
        html: () => ({ fadeIn: () => {} }),
        hide: () => {},
        fadeIn: () => {},
        addClass: () => {},
        removeClass: () => {},
        attr: () => {},
        get: () => [undefined],
    }),
    close: () => {
        state.closed++;
    },
});

const { default: UIWindowPasswordChangeRequired } = await import(
    './UIWindowPasswordChangeRequired.js'
);

const submit = async () => {
    await submitHandler({ preventDefault: () => {} });
};

describe('the forced password-change gate', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn();
        globalThis.window = { user: { requires_password_change: true } };
        state.closed = 0;
        submitHandler = null;
        fields['.pcr-current'] = 'TempPass1!';
        fields['.pcr-new'] = 'ChosenPass1!';
        fields['.pcr-confirm'] = 'ChosenPass1!';
    });

    it('posts to the one route the gate lets through, with credentials', async () => {
        globalThis.fetch.mockResolvedValue({ ok: true });
        const gate = UIWindowPasswordChangeRequired({ show_close_button: false });
        await Promise.resolve();
        await submit();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('/user-protected/change-password');
        // The user-protected gate is cookie-only; a bearer token is refused.
        expect(init.credentials).toBe('include');
        expect(JSON.parse(init.body)).toEqual({
            password: 'TempPass1!',
            new_pass: 'ChosenPass1!',
        });
        await expect(gate).resolves.toBe(true);
    });

    it('clears the local flag and closes once the change lands', async () => {
        globalThis.fetch.mockResolvedValue({ ok: true });
        UIWindowPasswordChangeRequired({ show_close_button: false });
        await Promise.resolve();
        await submit();

        expect(globalThis.window.user.requires_password_change).toBe(false);
        expect(state.closed).toBe(1);
    });

    it('refuses to reuse the password the admin handed over', async () => {
        // The whole point of the gate: the admin still knows this one.
        fields['.pcr-new'] = 'TempPass1!';
        fields['.pcr-confirm'] = 'TempPass1!';
        UIWindowPasswordChangeRequired({ show_close_button: false });
        await Promise.resolve();
        await submit();

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('does not submit a mismatch, a blank, or a weak password', async () => {
        const cases = [
            { '.pcr-confirm': 'Different1!' },
            { '.pcr-new': '' },
            { '.pcr-new': 'weak', '.pcr-confirm': 'weak' },
        ];
        for (const over of cases) {
            fields['.pcr-current'] = 'TempPass1!';
            fields['.pcr-new'] = 'ChosenPass1!';
            fields['.pcr-confirm'] = 'ChosenPass1!';
            Object.assign(fields, over);
            submitHandler = null;
            UIWindowPasswordChangeRequired({ show_close_button: false });
            await Promise.resolve();
            await submit();
        }
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('stays open on a rejected change, so the gate cannot be escaped', async () => {
        globalThis.fetch.mockResolvedValue({
            ok: false,
            statusText: 'Forbidden',
            json: async () => ({ message: 'Wrong password' }),
        });
        UIWindowPasswordChangeRequired({ show_close_button: false });
        await Promise.resolve();
        await submit();

        expect(state.closed).toBe(0);
        expect(globalThis.window.user.requires_password_change).toBe(true);
    });

    it('omits the close button when it is a gate', async () => {
        UIWindowPasswordChangeRequired({ show_close_button: false });
        await Promise.resolve();
        expect(state.el.body).not.toContain('generic-close-window-button');
    });
});
