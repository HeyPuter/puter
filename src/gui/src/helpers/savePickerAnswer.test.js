import { afterEach, describe, expect, it, vi } from 'vitest';
import createSavePickerAnswer, { signSavedFile } from './savePickerAnswer.js';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const setup = () => {
    const cancelled = vi.fn();
    return { cancelled, answer: createSavePickerAnswer({ cancelled }) };
};

describe('createSavePickerAnswer', () => {
    it('answers cancelled once when the picker is cancelled, then closed', () => {
        const { cancelled, answer } = setup();
        answer.cancel();
        answer.close();

        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(answer.saved()).toBe(false);
    });

    it('aborts the download and answers cancelled when the picker closes', () => {
        const { cancelled, answer } = setup();
        answer.close();

        expect(answer.signal.aborted).toBe(true);
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(answer.answered).toBe(true);
    });

    it('runs one save at a time', () => {
        const { answer } = setup();

        expect(answer.startSave()).toBe(true);
        expect(answer.startSave()).toBe(false);
        answer.endSave();
        expect(answer.startSave()).toBe(true);
    });

    it('starts no save once the caller is answered', () => {
        const { answer } = setup();
        answer.cancel();

        expect(answer.startSave()).toBe(false);
    });

    it('leaves the answer to a write that is running when the picker closes', async () => {
        const { cancelled, answer } = setup();
        const write = deferred();
        const writing = answer.write(() => write.promise);
        answer.close();

        expect(cancelled).not.toHaveBeenCalled();
        write.resolve({ uid: 'file-1' });
        expect(await writing).toEqual({ uid: 'file-1' });
        expect(answer.saved()).toBe(true);
        expect(cancelled).not.toHaveBeenCalled();
    });

    it('answers cancelled once a write fails after the picker closed', async () => {
        const { cancelled, answer } = setup();
        const write = deferred();
        const writing = answer.write(() => write.promise);
        answer.close();
        write.reject(new Error('Storage full'));

        expect(await writing).toBeUndefined();
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(answer.saved()).toBe(false);
    });

    it('throws a failed write while the picker is open, without answering', async () => {
        const { cancelled, answer } = setup();
        let caught;
        try {
            await answer.write(async () => {
                throw new Error('Storage full');
            });
        } catch ( err ) {
            caught = err;
        }

        expect(caught?.message).toBe('Storage full');
        expect(answer.answered).toBe(false);
        // Closing after a failed write isn't held back by it.
        answer.close();
        expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('skips a write once the caller is answered', async () => {
        const { answer } = setup();
        const run = vi.fn();
        answer.close();

        expect(await answer.write(run)).toBeUndefined();
        expect(run).not.toHaveBeenCalled();
    });

    it('answers saved only once', () => {
        const { cancelled, answer } = setup();

        expect(answer.saved()).toBe(true);
        expect(answer.saved()).toBe(false);
        answer.close();
        expect(cancelled).not.toHaveBeenCalled();
    });
});

describe('signSavedFile', () => {
    afterEach(() => {
        delete globalThis.puter;
    });

    it('retries one failed sign', async () => {
        const sign = vi.fn()
            .mockRejectedValueOnce(new Error('Sign failed'))
            .mockResolvedValueOnce({ items: { uid: 'file-1' } });
        globalThis.puter = { fs: { sign } };

        expect(await signSavedFile('app-1', 'file-1')).toEqual({ items: { uid: 'file-1' } });
        expect(sign).toHaveBeenCalledTimes(2);
        expect(sign).toHaveBeenCalledWith('app-1', { uid: 'file-1', action: 'write' });
    });

    it('rejects when the retry fails too', async () => {
        const sign = vi.fn(async () => {
            throw new Error('Sign failed');
        });
        globalThis.puter = { fs: { sign } };
        let caught;
        try {
            await signSavedFile('app-1', 'file-1');
        } catch ( err ) {
            caught = err;
        }

        expect(caught?.message).toBe('Sign failed');
        expect(sign).toHaveBeenCalledTimes(2);
    });
});
