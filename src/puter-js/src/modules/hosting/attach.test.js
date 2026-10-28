import { describe, expect, it, vi } from 'vitest';
import { attach } from './attach.js';

const hostingWith = (attachCustomDomain_) => ({
    puter: { ui: { attachCustomDomain_ } },
});

describe('hosting.attach', () => {
    it('hands the subdomain to the dialog and returns its answer', async () => {
        const dialog = vi.fn(async () => ({ hostname: 'www.example.com' }));
        await expect(attach.call(hostingWith(dialog), 'mysite')).resolves.toEqual({
            hostname: 'www.example.com',
        });
        expect(dialog).toHaveBeenCalledWith('mysite');
    });

    it('accepts a full hosted host', async () => {
        const dialog = vi.fn(async () => null);
        await attach.call(hostingWith(dialog), ' mysite.puter.site ');
        expect(dialog).toHaveBeenCalledWith('mysite');
    });

    it.each([undefined, '', '   ', 42])('rejects %j', async (value) => {
        const dialog = vi.fn();
        await expect(attach.call(hostingWith(dialog), value)).rejects.toMatchObject({
            code: 'invalid_argument',
        });
        expect(dialog).not.toHaveBeenCalled();
    });
});
