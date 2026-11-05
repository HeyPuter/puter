// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.def = globalThis.def ?? (value => value);

const { openRevalidatePopup } = await import('./openid.js');

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('openRevalidatePopup', () => {
    it('rejects when the browser blocks the popup', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        await expect(openRevalidatePopup('https://puter.test/revalidate')).rejects.toThrow('Popup blocked');
    });

    it('rejects once the popup is closed without finishing', async () => {
        vi.useFakeTimers();
        const popup = { closed: false };
        vi.spyOn(window, 'open').mockReturnValue(popup);
        const result = openRevalidatePopup('https://puter.test/revalidate');
        popup.closed = true;
        vi.advanceTimersByTime(300);
        await expect(result).rejects.toThrow('Popup closed');
    });
});
