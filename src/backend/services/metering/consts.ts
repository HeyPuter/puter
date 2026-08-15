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

// Constants for the metering service, including prefixes for keys and default subscription IDs.
export const GLOBAL_APP_KEY = 'os-global';
export const METRICS_PREFIX = 'metering';
export const POLICY_PREFIX = 'policy';
/** Dots in usage types are escaped so they don't collide with kv nested paths */
export const PERIOD_ESCAPE = '_dot_';
/**
 * Field on an actor's monthly usage record holding the claim for that month's
 * recurring charges. Lives on the record itself so every read that already
 * fetches usage can tell whether the charges are settled without a second
 * lookup. Must match the `monthlyChargesApplied` member of `UsageByType`.
 */
export const MONTHLY_CHARGE_CLAIM = 'monthlyChargesApplied';
export const DEFAULT_FREE_SUBSCRIPTION = 'user_free';
export const DEFAULT_TEMP_SUBSCRIPTION = 'temp_free';

/**
 * The policies an account holds without paying for anything. Everything else —
 * the paid plans registered by an extension, and the unlimited policy a
 * deployment can turn on for itself — counts as a subscription for the purposes
 * of `requireSubscription` (see `assertActorHasSubscription`). Kept as a set of
 * free ids rather than a list of paid ones so a plan added by an extension is
 * recognised without touching core.
 */
export const FREE_SUBSCRIPTION_IDS: ReadonlySet<string> = new Set([
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
]);

// WARNING: DO NOT USE THESE IN PROD
export const UNLIMITED_SUBSCRIPTION = 'unlimited';
