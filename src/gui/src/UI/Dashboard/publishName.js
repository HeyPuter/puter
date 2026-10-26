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

// The names a website or worker can be published under, as the backend
// checks them: a website's is a DNS label (SubdomainDriver), and a worker's
// also allows underscores (WorkerDriver).

/**
 * @typedef {object} PublishNameRule
 * @property {RegExp} invalid Characters the name can't hold.
 * @property {number} maxLength
 */

/** @type {{ website: PublishNameRule, worker: PublishNameRule }} */
export const PUBLISH_NAME_RULES = {
    website: { invalid: /[^a-z0-9-]/g, maxLength: 64 },
    // The name becomes a hostname label, which DNS caps at 63.
    worker: { invalid: /[^a-z0-9_-]/g, maxLength: 63 },
};

/**
 * What a typed name becomes as the user types: lowercase, with whitespace
 * runs turned into a hyphen and anything else the rule refuses dropped.
 *
 * @param {string} value
 * @param {PublishNameRule} rule
 * @returns {string}
 */
export const normalizePublishName = (value, rule) => String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(rule.invalid, '');

/**
 * The name to submit: normalized, without the leading or trailing hyphens a
 * hostname can't start or end with. Empty when nothing usable is left.
 *
 * @param {string} value
 * @param {PublishNameRule} rule
 * @returns {string}
 */
export const finalizePublishName = (value, rule) => normalizePublishName(value, rule)
    .slice(0, rule.maxLength)
    .replace(/^-+|-+$/g, '');
