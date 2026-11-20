/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';

import {
    anthropicToolStream,
    argumentPieces,
    chatCompletionsToolStream,
    chatToolCallDeltas,
    responsesToolStream,
    STREAMED_TOOL_CALLS,
} from './toolCallStreamTestUtil.js';

type Data = Record<string, any>;

const inputs = STREAMED_TOOL_CALLS.map((call) => call.input);

/** Joins pieces into one string per key, in the order the keys first appear. */
const joinBy = (pieces: [unknown, string][]): string[] => {
    const joined = new Map<unknown, string>();
    for (const [key, piece] of pieces) {
        joined.set(key, (joined.get(key) ?? '') + piece);
    }
    return [...joined.values()];
};

describe('toolCallStreamTestUtil', () => {
    it("argumentPieces rebuilds each call's input", () => {
        for (const call of STREAMED_TOOL_CALLS) {
            const pieces = argumentPieces(call);
            expect(pieces).toHaveLength(3);
            expect(JSON.parse(pieces.join(''))).toEqual(call.input);
        }
        // A piece boundary inside an escape: `\` ends one piece, `"` starts the next.
        const notes = argumentPieces(STREAMED_TOOL_CALLS[1]);
        expect(notes[0].endsWith('\\')).toBe(true);
        expect(notes[1].startsWith('"')).toBe(true);
    });

    it('chatToolCallDeltas interleaves calls', () => {
        const indexes = (interleave: boolean) =>
            chatToolCallDeltas({ interleave })
                .slice(0, 3)
                .map((chunk) => chunk[0].index);
        expect(indexes(true)).toEqual([0, 1, 0]);
        expect(indexes(false)).toEqual([0, 0, 0]);
    });

    it("each vendor stream carries both calls' pieces in order", () => {
        for (const interleave of [false, true]) {
            const chat = chatCompletionsToolStream(
                chatToolCallDeltas({ interleave }),
            );
            const chatPieces = chat.flatMap(({ data }) =>
                ((data as Data).choices?.[0]?.delta?.tool_calls ?? []).map(
                    (call: Data): [unknown, string] => [
                        call.index,
                        call.function.arguments,
                    ],
                ),
            );
            expect(joinBy(chatPieces).map((a) => JSON.parse(a))).toEqual(
                inputs,
            );
        }

        const responsesPieces = responsesToolStream()
            .map(({ data }) => data as Data)
            .filter(
                (data) =>
                    data.type === 'response.function_call_arguments.delta',
            )
            .map((data): [unknown, string] => [data.item_id, data.delta]);
        expect(joinBy(responsesPieces).map((a) => JSON.parse(a))).toEqual(
            inputs,
        );

        const anthropicPieces = anthropicToolStream()
            .map(({ data }) => data as Data)
            .filter((data) => data.delta?.type === 'input_json_delta')
            .map((data): [unknown, string] => [
                data.index,
                data.delta.partial_json,
            ]);
        expect(joinBy(anthropicPieces).map((a) => JSON.parse(a))).toEqual(
            inputs,
        );
    });
});
