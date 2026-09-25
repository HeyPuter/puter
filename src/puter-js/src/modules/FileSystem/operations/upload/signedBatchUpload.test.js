import { describe, expect, it } from 'vitest';

import {
    isSignedBatchWriteUnavailableError,
    sharedFailureFields,
} from './signedBatchUpload.js';

// An over-quota account fails every item of the batch with the same rejection.
// Callers — including `upload`'s own error handler, which is what asks the user
// to free up space — key on `code`/`status`, so those have to survive the trip
// through the partial-failure error.
describe('sharedFailureFields', () => {
    it('reports the code and status every failed item shares', () => {
        const failed = [
            { code: 'storage_limit_reached', status: 413 },
            { code: 'storage_limit_reached', status: 413 },
        ];
        expect(sharedFailureFields(failed)).toEqual({
            code: 'storage_limit_reached',
            status: 413,
        });
    });

    it('reports nothing when the failures disagree', () => {
        const failed = [
            { code: 'storage_limit_reached', status: 413 },
            { code: 'forbidden', status: 403 },
        ];
        expect(sharedFailureFields(failed)).toEqual({});
    });

    it('reports nothing when a failure carries no code at all', () => {
        const failed = [
            { code: 'storage_limit_reached', status: 413 },
            { code: undefined, status: undefined },
        ];
        expect(sharedFailureFields(failed)).toEqual({});
    });

    it('still reports a status when the items carry no codes', () => {
        const failed = [{ status: 413 }, { status: 413 }];
        expect(sharedFailureFields(failed)).toEqual({ status: 413 });
    });
});

describe('isSignedBatchWriteUnavailableError', () => {
    it('treats a partial failure as a working endpoint', () => {
        // 404 is otherwise read as "this backend has no signed batch writes".
        // On a partial error it is the items' status, and retrying the whole
        // batch on the legacy path would only fail again.
        const partial = Object.assign(new Error('partial'), {
            partial: true,
            status: 404,
        });
        expect(isSignedBatchWriteUnavailableError(partial)).toBe(false);
    });

    it('still detects a missing endpoint', () => {
        expect(
            isSignedBatchWriteUnavailableError(
                Object.assign(new Error('nope'), { status: 404 }),
            ),
        ).toBe(true);
    });

    it('does not treat a structured error as a missing endpoint', () => {
        expect(
            isSignedBatchWriteUnavailableError(
                Object.assign(new Error('nope'), {
                    status: 404,
                    body: { code: 'subject_does_not_exist' },
                }),
            ),
        ).toBe(false);
    });
});
