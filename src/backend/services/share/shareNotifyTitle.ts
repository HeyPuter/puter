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

/**
 * What a share notification says, and how several senders fold into one. Pure,
 * because the wording is a function of who has shared and how much — not of
 * whichever request happened to be last.
 */

/** One sender's contribution to a grouped notification. */
export interface ShareSender {
    username: string;
    count: number;
}

/** How many senders are named before the rest become "others". */
const NAMED_LIMIT = 2;

/** Stands in for a sender with no username, rather than saying "undefined". */
const ANONYMOUS = 'Someone';

/** Items across every sender. */
export const shareNotifyCount = (senders: ShareSender[]): number =>
    senders.reduce((total, sender) => total + Math.max(0, sender.count), 0);

/**
 * Add `count` items from `username` to what the recipient was already told.
 * Insertion order is kept, so the wording grows by a name rather than
 * rearranging itself under someone reading it.
 */
export const mergeShareSender = (
    senders: ShareSender[],
    username: string | undefined,
    count: number,
): ShareSender[] => {
    const name = username || ANONYMOUS;
    const merged = senders.map((sender) => ({ ...sender }));
    const existing = merged.find((sender) => sender.username === name);
    if (existing) {
        existing.count += count;
        return merged;
    }
    merged.push({ username: name, count });
    return merged;
};

/**
 * The senders recorded on a notification's fields. Tolerates the single-sender
 * shape written before grouping existed — a row outlives the deploy that
 * changes it, and dropping its sender would make the next share read as the
 * first.
 */
export const shareSendersFromFields = (fields: unknown): ShareSender[] => {
    const source = (fields ?? {}) as {
        senders?: unknown;
        username?: unknown;
        count?: unknown;
    };
    const named = (value: unknown): string =>
        typeof value === 'string' && value ? value : ANONYMOUS;

    if (Array.isArray(source.senders)) {
        return source.senders
            .map((entry) => {
                const sender = (entry ?? {}) as {
                    username?: unknown;
                    count?: unknown;
                };
                return {
                    username: named(sender.username),
                    count: Number(sender.count) || 0,
                };
            })
            .filter((sender) => sender.count > 0);
    }

    const count = Number(source.count) || 0;
    if (count <= 0) return [];
    return [{ username: named(source.username), count }];
};

/** "alice", "alice and bob", "alice, bob and 2 others". */
export const senderList = (senders: ShareSender[]): string => {
    const names = senders.map((sender) => sender.username || ANONYMOUS);
    if (names.length === 0) return ANONYMOUS;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    const rest = names.length - NAMED_LIMIT;
    return `${names.slice(0, NAMED_LIMIT).join(', ')} and ${rest} ${
        rest === 1 ? 'other' : 'others'
    }`;
};

/** Unchanged for one sender, so nothing regresses for the common case. */
export const shareNotifyTitle = (senders: ShareSender[]): string => {
    const count = shareNotifyCount(senders);
    const what = count === 1 ? 'an item' : `${count} items`;
    return `${senderList(senders)} shared ${what} with you`;
};

// -- Email digests ------------------------------------------------------
//
// Email can't be rewritten the way a notification can, so it gets the grouped
// wording by being held briefly and merged. These shapes are the accumulator.

/**
 * One named item. No `link` or `path` when it isn't addressable; wording is
 * unchanged. `path` is the masked form the link was built from, kept so the
 * digest's own link can point at every item at once.
 */
export interface DigestItem {
    name: string;
    link?: string;
    path?: string;
}

/** One sender's contribution to a digest email. */
export interface DigestEntry {
    username: string;
    count: number;
    /** Named items, newest last. */
    items: DigestItem[];
}

/** How many item names one digest line spells out before counting the rest. */
const NAMED_ITEMS_LIMIT = 3;

/** Fold `count` items (named where known) from `username` into the digest. */
export const mergeDigestEntry = (
    entries: DigestEntry[],
    username: string | undefined,
    count: number,
    items: DigestItem[] = [],
): DigestEntry[] => {
    const name = username || 'Someone';
    const merged = entries.map((entry) => ({
        ...entry,
        items: [...entry.items],
    }));
    const existing = merged.find((entry) => entry.username === name);
    if (existing) {
        existing.count += count;
        existing.items.push(...items);
        return merged;
    }
    merged.push({ username: name, count, items: [...items] });
    return merged;
};

/** Every addressable item's masked path, across senders, in digest order. */
export const digestItemPaths = (entries: DigestEntry[]): string[] => {
    const paths: string[] = [];
    for (const entry of entries) {
        for (const item of entry.items) {
            if (item.path && !paths.includes(item.path)) paths.push(item.path);
        }
    }
    return paths;
};

/**
 * The digest's subject: "alice shared report.txt with you" when there is
 * exactly one named item, counts otherwise.
 */
export const digestSubject = (
    entries: DigestEntry[],
    opts: { suffix?: string } = {},
): string => {
    const total = entries.reduce(
        (sum, entry) => sum + Math.max(0, entry.count),
        0,
    );
    const what =
        total === 1
            ? (entries.find((entry) => entry.items.length > 0)?.items[0].name ??
              'an item')
            : `${total} items`;
    const base = `${senderList(entries)} shared ${what} with you`;
    return opts.suffix ? `${base} ${opts.suffix}` : base;
};

/**
 * One line per sender, twice over: `what` as a sentence, and
 * `lead`/`items`/`trail` split at the names so each can be linked.
 * Concatenating the three reproduces `what` exactly.
 */
export interface DigestLine {
    sender: string;
    what: string;
    lead: string;
    items: DigestItem[];
    trail: string;
}

/** One rendered line per sender: who, and what they shared. */
export const digestLines = (entries: DigestEntry[]): DigestLine[] =>
    entries.map((entry) => {
        const named = entry.items.slice(0, NAMED_ITEMS_LIMIT);
        const names = named.map((item) => item.name);
        let lead: string;
        let trail = '';
        if (entry.count === 1 && named.length === 1) {
            lead = '';
        } else if (named.length === 0) {
            lead = `${entry.count} items`;
        } else {
            const rest = entry.count - named.length;
            lead = `${entry.count} items — `;
            if (rest > 0) trail = `, +${rest} more`;
        }
        return {
            sender: entry.username,
            what: lead + names.join(', ') + trail,
            lead,
            items: named,
            trail,
        };
    });
