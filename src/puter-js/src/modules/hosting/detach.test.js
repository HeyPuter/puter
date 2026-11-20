import { describe, expect, it, vi } from 'vitest';
import { detach } from './detach.js';

const hostingWith = (detachCustomDomain_) => ({
    puter: { ui: { detachCustomDomain_ } },
});

describe('hosting.detach', () => {
    it('hands the subdomain to the dialog and returns the domains removed', async () => {
        const dialog = vi.fn(async () => [{ hostname: 'www.example.com' }]);
        await expect(detach.call(hostingWith(dialog), 'mysite')).resolves.toEqual([
            { hostname: 'www.example.com' },
        ]);
        expect(dialog).toHaveBeenCalledWith('mysite');
    });

    it('accepts a full hosted host', async () => {
        const dialog = vi.fn(async () => []);
        await detach.call(hostingWith(dialog), ' mysite.puter.site ');
        expect(dialog).toHaveBeenCalledWith('mysite');
    });

    it.each([undefined, '', '   ', 42])('rejects %j', async (value) => {
        const dialog = vi.fn();
        await expect(detach.call(hostingWith(dialog), value)).rejects.toMatchObject({
            code: 'invalid_argument',
        });
        expect(dialog).not.toHaveBeenCalled();
    });
});
