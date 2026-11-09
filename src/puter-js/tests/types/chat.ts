import type { ChatOptions } from '../../index.js';

export const fast: ChatOptions = { model: 'claude-opus-5-5', speed: 'fast' };
export const standard: ChatOptions = {
    model: 'claude-opus-5-5',
    speed: 'standard',
};
// @ts-expect-error Speed is either 'fast' or 'standard'.
export const invalidSpeed: ChatOptions = { speed: 'turbo' };
