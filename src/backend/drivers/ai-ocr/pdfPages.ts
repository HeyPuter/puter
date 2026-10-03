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
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { inflateSync } from 'node:zlib';

/** Total that object streams may inflate to before the count gives up. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

// A name ends at whitespace, a delimiter or the end of input.
const TYPE_PAGE = /\/Type[\s\0]*\/Page(?![^\s\0/<>[\]()%{}])/;
const TYPE_PAGES = /\/Type[\s\0]*\/Pages(?![^\s\0/<>[\]()%{}])/;
const TYPE_OBJECT_STREAM = /\/Type[\s\0]*\/ObjStm(?![^\s\0/<>[\]()%{}])/;
const COUNT = /\/Count[\s\0]+(\d{1,10})(?![\d.])/;
const STREAM_START = />>[\s\0]*stream(?:\r\n|\r|\n)/;
const FLATE_FILTER =
    /\/Filter[\s\0]*(?:\/(?:FlateDecode|Fl)|\[[\s\0]*\/(?:FlateDecode|Fl)[\s\0]*\])/;

/** `/P#61ge` is the name `/Page`. */
const decodeNameEscapes = (dict: string): string =>
    dict.includes('#')
        ? dict.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
              String.fromCharCode(parseInt(hex, 16)),
          )
        : dict;

/** The objects packed in an object stream, or null when it can't be read. */
const readObjectStream = (
    dict: string,
    data: Buffer,
    budget: number,
): { objects: Array<[number, string]>; inflated: number } | null => {
    let content = data;
    let inflated = 0;
    if (/\/Filter/.test(dict)) {
        const predictor = Number(/\/Predictor[\s\0]+(\d+)/.exec(dict)?.[1]);
        if (!FLATE_FILTER.test(dict) || predictor > 1 || budget < 1)
            return null;
        try {
            content = inflateSync(data, { maxOutputLength: budget });
        } catch {
            return null;
        }
        inflated = content.length;
    }

    const count = Number(/\/N[\s\0]+(\d+)/.exec(dict)?.[1]);
    const first = Number(/\/First[\s\0]+(\d+)/.exec(dict)?.[1]);
    const text = content.toString('latin1');
    if (!Number.isInteger(count) || !(first <= text.length)) return null;
    // The header is `count` pairs of object number and offset from `first`.
    const header = (text.slice(0, first).match(/\d+/g) ?? []).map(Number);
    if (header.length < count * 2) return null;

    const objects: Array<[number, string]> = [];
    for (let i = 0; i < count; i++) {
        const start = first + header[i * 2 + 1]!;
        const end = i + 1 < count ? first + header[i * 2 + 3]! : text.length;
        objects.push([header[i * 2]!, text.slice(start, end)]);
    }
    return { objects, inflated };
};

/**
 * Pages in a PDF, read from its page tree without a full parse: the larger of
 * the tree's `/Count` and the number of page objects, since a crafted file can
 * understate either. Null when the bytes show neither, including an encrypted
 * or undecodable object stream that could hide them. Stops at `limit`.
 */
export function countPdfPages(pdf: Buffer, limit = Infinity): number | null {
    if (!pdf.subarray(0, 1024).includes('%PDF-')) return null;
    const text = pdf.toString('latin1');

    // Keyed by object number, so a later definition replaces an earlier one
    // as it does in an incrementally updated file.
    const treeCounts = new Map<number, number>();
    const pageObjects = new Set<number>();
    const visit = (id: number, rawDict: string): boolean => {
        const dict = decodeNameEscapes(rawDict);
        treeCounts.delete(id);
        pageObjects.delete(id);
        if (TYPE_PAGES.test(dict)) {
            const count = Number(COUNT.exec(dict)?.[1] ?? 0);
            treeCounts.set(id, count);
            return count >= limit;
        }
        if (TYPE_PAGE.test(dict)) pageObjects.add(id);
        return pageObjects.size >= limit;
    };

    let inflated = 0;
    // Bounded quantifiers keep the scan linear on crafted input.
    const objectHeader =
        /(?<!\d)(\d{1,10})[\s\0]{1,64}\d{1,5}[\s\0]{1,64}obj\b/g;
    let header: RegExpExecArray | null;
    while ((header = objectHeader.exec(text))) {
        const start = objectHeader.lastIndex;
        const endobj = text.indexOf('endobj', start);
        const end = endobj < 0 ? text.length : endobj;
        objectHeader.lastIndex = end;

        const body = text.slice(start, end);
        const stream = STREAM_START.exec(body);
        const dict = stream ? body.slice(0, stream.index + 2) : body;
        if (!TYPE_OBJECT_STREAM.test(dict)) {
            if (visit(Number(header[1]), dict)) return limit;
            continue;
        }

        const dataEnd = body.lastIndexOf('endstream');
        if (!stream || dataEnd < 0) return null;
        const data = pdf.subarray(
            start + stream.index + stream[0].length,
            start + dataEnd,
        );
        const packed = readObjectStream(
            dict,
            data,
            MAX_INFLATED_BYTES - inflated,
        );
        if (!packed) return null;
        inflated += packed.inflated;
        for (const [id, objectDict] of packed.objects) {
            if (visit(id, objectDict)) return limit;
        }
    }

    let pages = pageObjects.size;
    for (const count of treeCounts.values()) pages = Math.max(pages, count);
    return pages > 0 ? Math.min(pages, limit) : null;
}
