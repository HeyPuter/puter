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

/** Hard ceiling on inflated object-stream bytes, regardless of input size. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
/**
 * Zlib can't compress past ~1032:1 — ties the worst case to what was actually
 * uploaded.
 */
const MAX_INFLATE_RATIO = 1024;
/**
 * An object stream claiming more objects or a bigger header than this can't be
 * trusted cheaply.
 */
const MAX_OBJSTM_OBJECTS = 100_000;
const MAX_OBJSTM_HEADER_BYTES = 1024 * 1024;

// A name ends at whitespace, a delimiter or the end of input.
const TYPE_PAGE = /\/Type[\s\0]*\/Page(?![^\s\0/<>[\]()%{}])/;
const TYPE_PAGES = /\/Type[\s\0]*\/Pages(?![^\s\0/<>[\]()%{}])/;
const TYPE_OBJECT_STREAM = /\/Type[\s\0]*\/ObjStm(?![^\s\0/<>[\]()%{}])/;
const HAS_TYPE = /\/Type[\s\0]*\//;
const KIDS = /\/Kids[\s\0]*\[([^\]]*)\]/;
const KID_REF = /(?<!\d)(\d{1,10})[\s\0]+\d{1,10}[\s\0]+R\b/g;
const COUNT = /\/Count[\s\0]+(\d{1,10})(?![\d.])/;
const COUNT_INDIRECT = /\/Count[\s\0]+\d{1,10}[\s\0]+\d{1,10}[\s\0]+R\b/;
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
    if (!Number.isInteger(count) || count > MAX_OBJSTM_OBJECTS) return null;
    if (!Number.isInteger(first) || first > MAX_OBJSTM_HEADER_BYTES)
        return null;
    const text = content.toString('latin1');
    if (first > text.length) return null;

    // The header is `count` pairs of object number and offset from `first`;
    // read only that many integers instead of matching the whole prefix.
    const header: number[] = [];
    const digits = /\d+/g;
    let match: RegExpExecArray | null;
    while (
        header.length < count * 2 &&
        (match = digits.exec(text)) &&
        match.index < first
    ) {
        header.push(Number(match[0]));
    }
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
    // Zlib bombs are a fixed multiple of their compressed size; scale the
    // ceiling down for small files instead of always allowing the max.
    const inflateBudget = Math.min(
        MAX_INFLATED_BYTES,
        pdf.length * MAX_INFLATE_RATIO,
    );

    // Keyed by object number. A redefinition can only raise what's counted
    // for that id, never lower it — an unreferenced redefinition crafted to
    // shrink the tree can't undercount what an earlier one established.
    const treeCounts = new Map<number, number>();
    const pageObjects = new Set<number>();
    // A page tree kid with no /Type and no /Kids is a page to real readers.
    // Only kids count: outline items, widgets and name-tree leaves look the
    // same but never sit in a page tree's /Kids.
    const treeKids = new Set<number>();
    const untypedLeaves = new Set<number>();
    const visit = (id: number, rawDict: string): boolean => {
        const dict = decodeNameEscapes(rawDict);
        const typed = HAS_TYPE.test(dict);
        const kids = KIDS.exec(dict);
        // An untyped node needs a /Count to pass as a page tree node; form
        // fields and name trees carry /Kids without one.
        if (kids && (TYPE_PAGES.test(dict) || (!typed && COUNT.test(dict)))) {
            for (const ref of kids[1]!.matchAll(KID_REF))
                treeKids.add(Number(ref[1]));
        }
        if (TYPE_PAGES.test(dict)) {
            // An indirect /Count (`N 0 R`) isn't a count — it's a reference
            // whose object number happens to look like one.
            const count = COUNT_INDIRECT.test(dict)
                ? 0
                : Number(COUNT.exec(dict)?.[1] ?? 0);
            treeCounts.set(id, Math.max(count, treeCounts.get(id) ?? 0));
            return count >= limit;
        }
        if (TYPE_PAGE.test(dict)) pageObjects.add(id);
        else if (!typed && !kids) untypedLeaves.add(id);
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
        if (!TYPE_OBJECT_STREAM.test(decodeNameEscapes(dict))) {
            if (visit(Number(header[1]), dict)) return limit;
            continue;
        }

        const dataEnd = body.lastIndexOf('endstream');
        if (!stream || dataEnd < 0) return null;
        const data = pdf.subarray(
            start + stream.index + stream[0].length,
            start + dataEnd,
        );
        const packed = readObjectStream(dict, data, inflateBudget - inflated);
        if (!packed) return null;
        inflated += packed.inflated;
        for (const [id, objectDict] of packed.objects) {
            if (visit(id, objectDict)) return limit;
        }
    }

    for (const id of untypedLeaves) {
        if (treeKids.has(id)) pageObjects.add(id);
    }
    let pages = pageObjects.size;
    for (const count of treeCounts.values()) pages = Math.max(pages, count);
    return pages > 0 ? Math.min(pages, limit) : null;
}
