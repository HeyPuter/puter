import { describe, expect, it } from 'vitest';
import { ConvoHistory } from './convoHistory.js';

const user = (id, content) => ({
    type: 'conversation.item.added',
    item: { id, type: 'message', role: 'user', status: 'completed', content },
});
const texts = (history) =>
    history.replay(40, 48 * 1024).map(({ item }) => item.content[0].text);

describe('ConvoHistory', () => {
    it('cuts text without word breaks at the played share', () => {
        const history = new ConvoHistory(() => false);
        history.observe({
            type: 'response.output_item.added',
            response_id: 'r',
            item: { id: 'a', type: 'message', role: 'assistant', content: [] },
        });
        history.observe({
            type: 'response.output_audio.delta',
            item_id: 'a',
            delta: 'A'.repeat(64), // 1 ms
        });
        history.observe({
            type: 'response.output_item.done',
            item: {
                id: 'a',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [
                    { type: 'output_audio', transcript: '今日は晴れです' },
                ],
            },
        });
        history.truncate('a', 0.5);
        expect(texts(history)).toEqual(['今日は']);
    });

    it('keeps a known transcript when a later copy of the item lacks it', () => {
        const history = new ConvoHistory(() => false);
        history.observe(user('u', [{ type: 'input_audio', transcript: null }]));
        expect(history.awaitingTranscript).toBe(true);
        history.observe({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id: 'u',
            content_index: 0,
            transcript: 'hello',
        });
        expect(history.awaitingTranscript).toBe(false);
        history.observe({
            ...user('u', [{ type: 'input_audio', transcript: null }]),
            type: 'conversation.item.done',
        });
        expect(texts(history)).toEqual(['hello']);
    });

    it('keeps a bounded number of the newest items', () => {
        const history = new ConvoHistory(() => false);
        for (let i = 0; i < 100; i++)
            history.observe(
                user(`u${i}`, [{ type: 'input_text', text: `${i}` }]),
            );
        expect(history.replay(100, Infinity)).toHaveLength(80);
        expect(texts(history).at(-1)).toBe('99');
    });

    it('stops at the first item over the byte budget instead of leaving a gap', () => {
        const history = new ConvoHistory(() => false);
        history.observe(user('u1', [{ type: 'input_text', text: 'old' }]));
        history.observe(
            user('u2', [{ type: 'input_text', text: 'x'.repeat(50_000) }]),
        );
        history.observe(user('u3', [{ type: 'input_text', text: 'new' }]));
        expect(texts(history)).toEqual(['new']);
    });
});
