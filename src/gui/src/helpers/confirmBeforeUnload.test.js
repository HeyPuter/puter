import { describe, expect, it } from 'vitest';
import { should_confirm_before_unload } from './confirmBeforeUnload.js';

describe('should_confirm_before_unload', () => {
    it('lets a quiet page close without a dialog', () => {
        expect(should_confirm_before_unload()).toBe(false);
    });

    it('warns while an upload is still streaming', () => {
        expect(should_confirm_before_unload({ activeUploadCount: 1 })).toBe(true);
    });

    it('warns during an upload even with the open-window prompt off', () => {
        // The bug: a nearly-finished upload used to die silently on close.
        expect(should_confirm_before_unload({
            activeUploadCount: 2,
            openWindowCount: 0,
            promptOnOpenWindows: false,
        })).toBe(true);
    });

    it('stops warning once the last upload settles', () => {
        expect(should_confirm_before_unload({ activeUploadCount: 0 })).toBe(false);
    });

    it('ignores open windows unless the feature flag asks for it', () => {
        expect(should_confirm_before_unload({ openWindowCount: 3 })).toBe(false);
        expect(should_confirm_before_unload({
            openWindowCount: 3,
            promptOnOpenWindows: true,
        })).toBe(true);
    });
});
