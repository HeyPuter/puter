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

import { HttpError } from '../../core/http/HttpError.js';

/**
 * Match filters are globs compiled once at subscribe time and evaluated
 * in-process against a value the event already carries — never a store scan.
 * `**` crosses delimiters and is not bounded. A pattern gets one `**` and one
 * `*` per segment: every further unbounded wildcard multiplies the ways the
 * engine can split a non-matching path among them, and the subscriber names the
 * files a filter is tested against.
 */

// -- Limits -----------------------------------------------------------

export const MATCH_PATTERN_MAX_LENGTH = 256;
export const MATCH_PATTERN_MAX_SEGMENTS = 16;

/** Filter evaluations one event may spend before dispatch reports a gap. */
export const FILTER_EVALUATIONS_PER_EVENT = 200;

// -- Compilation ------------------------------------------------------

export interface CompileMatchOptions {
    /**
     * Delimiter a single `*` will not cross. `null` gives `*` no boundary at
     * all, which is what a KV prefix pattern wants.
     */
    separator?: string | null;
}

export interface CompiledMatch {
    readonly pattern: string;
    test(value: string): boolean;
}

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const invalidPattern = (why: string, pattern?: string): HttpError =>
    new HttpError(
        400,
        pattern ? `Match pattern ${why}: ${pattern}` : `Match pattern ${why}`,
        { legacyCode: 'invalid_subject_pattern' },
    );

const translateSegment = (
    segment: string,
    separator: string | null,
): string => {
    const notSeparator = separator
        ? `[^${escapeRegExp(separator)}]`
        : '[\\s\\S]';
    let out = '';
    for (const c of segment) {
        if (c === '*') out += `${notSeparator}*`;
        else if (c === '?') out += notSeparator;
        else out += escapeRegExp(c);
    }
    return out;
};

/**
 * Compile a glob to an anchored matcher. Consecutive `**` segments collapse to
 * one: they mean the same thing, and the repeated form is what makes the
 * generated expression backtrack.
 */
export function compileMatch(
    pattern: string,
    options: CompileMatchOptions = {},
): CompiledMatch {
    const separator = options.separator === undefined ? '/' : options.separator;

    if (typeof pattern !== 'string' || pattern.length === 0)
        throw invalidPattern('is empty');
    if (pattern.length > MATCH_PATTERN_MAX_LENGTH)
        throw invalidPattern(
            `exceeds ${MATCH_PATTERN_MAX_LENGTH} characters`,
            pattern,
        );

    const raw = separator === null ? [pattern] : pattern.split(separator);
    if (raw.length > MATCH_PATTERN_MAX_SEGMENTS)
        throw invalidPattern(
            `exceeds ${MATCH_PATTERN_MAX_SEGMENTS} segments`,
            pattern,
        );

    const segments = raw.filter(
        (segment, i) => segment !== '**' || raw[i - 1] !== '**',
    );

    // A lone `*` is pinned by the delimiters either side of it, so a wrong
    // split dies in one step; the one `**` is the only choice point left.
    // Ten stars in one segment is a second of CPU per event.
    const isGlobstar = (segment: string): boolean =>
        separator !== null && segment === '**';
    if (segments.filter(isGlobstar).length > 1)
        throw invalidPattern('may use `**` only once', pattern);
    for (const segment of segments)
        if (!isGlobstar(segment) && segment.split('*').length > 2)
            throw invalidPattern('may use `*` only once per segment', pattern);

    const escapedSeparator = separator ? escapeRegExp(separator) : '';
    let source = '^';
    for (let i = 0; i < segments.length; i++) {
        const isLast = i === segments.length - 1;
        if (separator !== null && segments[i] === '**') {
            source += isLast
                ? '[\\s\\S]*'
                : `(?:[\\s\\S]*${escapedSeparator})?`;
            continue;
        }
        source += translateSegment(segments[i], separator);
        if (!isLast) source += escapedSeparator;
    }
    source += '$';

    const regex = new RegExp(source);
    return {
        pattern,
        test: (value: string) => typeof value === 'string' && regex.test(value),
    };
}

// -- Evaluation -------------------------------------------------------

/**
 * A path relative to `anchorPath`, or `null` when it does not sit under the
 * anchor. The anchor itself relativizes to the empty string.
 */
export function relativeTo(anchorPath: string, path: string): string | null {
    if (path === anchorPath) return '';
    const prefix = anchorPath.endsWith('/') ? anchorPath : `${anchorPath}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export interface CappedEvaluation<T> {
    matched: T[];
    evaluated: number;
    /** True when the cap cut evaluation short, so callers can report a gap. */
    stoppedEarly: boolean;
}

/**
 * Run a filter over candidates, spending at most `limit` evaluations. A hot
 * anchor can carry more filtered subscriptions than one event should pay for.
 */
export function evaluateWithCap<T>(
    candidates: Iterable<T>,
    predicate: (candidate: T) => boolean,
    limit: number = FILTER_EVALUATIONS_PER_EVENT,
): CappedEvaluation<T> {
    const matched: T[] = [];
    let evaluated = 0;
    for (const candidate of candidates) {
        if (evaluated >= limit)
            return { matched, evaluated, stoppedEarly: true };
        evaluated++;
        if (predicate(candidate)) matched.push(candidate);
    }
    return { matched, evaluated, stoppedEarly: false };
}
