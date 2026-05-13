import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { handleWorkerSandboxPage } from './workerSandbox.ts';

interface CapturedResponse {
    contentType: string | undefined;
    body: string | undefined;
}

const makeRes = () => {
    const captured: CapturedResponse = {
        contentType: undefined,
        body: undefined,
    };
    const res = {
        type: vi.fn((mime: string) => {
            captured.contentType = mime;
            return res;
        }),
        send: vi.fn((value: string) => {
            captured.body = value;
            return res;
        }),
    };
    return { res: res as unknown as Response, captured };
};

describe('workerSandbox extension — handleWorkerSandboxPage', () => {
    it('sends the playground HTML page with text/html content type', () => {
        const { res, captured } = makeRes();

        handleWorkerSandboxPage({} as Request, res);

        expect(captured.contentType).toBe('html');
        expect(typeof captured.body).toBe('string');
        expect(captured.body).toContain('<!doctype html>');
        expect(captured.body).toContain('Puter Worker Sandbox Playground');
        // The page is meant to load the public puter SDK
        expect(captured.body).toContain('https://js.puter.com/v2/');
    });
});
