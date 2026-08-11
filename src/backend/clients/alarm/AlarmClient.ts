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

import { event as pdEvent } from '@pagerduty/pdjs';
import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import type { IConfig, PagerSeverity, SeverityRule } from '../../types';
import { PuterClient } from '../types';
import {
    meetsMinSeverity,
    resolveSeverityOverride,
    withinMaxSeverity,
} from './severity';
import { createSlackAlertHandler } from './slack';
import type {
    Alarm,
    AlarmFields,
    AlarmOptions,
    AlertHandler,
    AlertPayload,
    KnownErrorRule,
} from './types';

export type {
    Alarm,
    AlarmFields,
    AlarmOptions,
    AlertHandler,
    AlertPayload,
    KnownErrorRule,
} from './types';
export type { PagerSeverity } from '../../types';

// -- Types ------------------------------------------------------------

interface RegisteredHandler {
    name: string;
    /** Lowest severity this transport accepts. */
    minSeverity: PagerSeverity;
    /** Highest severity this transport accepts. */
    maxSeverity: PagerSeverity;
    handler: AlertHandler;
}

/** Severity used when neither the call site nor config picks one. */
const FALLBACK_SEVERITY: PagerSeverity = 'critical';
/**
 * How many recent occurrences an alarm keeps. An alarm is never cleared unless
 * something calls `clear`, and a hot one repeats for as long as the fault lasts
 * — so retaining every occurrence means retaining every message and field set
 * it was ever raised with, request bodies and actors included, for the life of
 * the process. The last few are what a human reads; the rest is only a count,
 * and `count` keeps that.
 */
const OCCURRENCE_HISTORY_LIMIT = 20;
/** Keeps `info` alarms out of the paging system unless config says otherwise. */
const DEFAULT_PAGERDUTY_MIN_SEVERITY: PagerSeverity = 'warning';
/** Slack's ceiling once a pager exists: chat gets what doesn't page. */
const DEFAULT_SLACK_MAX_SEVERITY_WITH_PAGER: PagerSeverity = 'info';

// -- Helpers ----------------------------------------------------------

/**
 * Deterministic short identifier derived from an alarm ID. Produces a readable
 * 3-word slug like "amber-delta-fox".
 */
const WORD_POOL = [
    'alpha',
    'amber',
    'arc',
    'bolt',
    'cape',
    'cask',
    'core',
    'crow',
    'dawn',
    'delta',
    'dune',
    'echo',
    'edge',
    'elk',
    'fern',
    'flint',
    'fog',
    'fox',
    'gate',
    'glow',
    'haze',
    'helm',
    'hive',
    'jade',
    'keel',
    'knot',
    'lark',
    'lime',
    'lynx',
    'mast',
    'mist',
    'moss',
    'node',
    'nova',
    'opal',
    'orbit',
    'palm',
    'peak',
    'pine',
    'pike',
    'quad',
    'quay',
    'rail',
    'reef',
    'rune',
    'sage',
    'shard',
    'silo',
    'slate',
    'spark',
    'surge',
    'tarn',
    'tide',
    'vale',
    'vane',
    'wren',
    'yard',
    'yew',
    'zeal',
    'zero',
    'zinc',
    'zone',
];

function shortId(id: string): string {
    const hash = createHash('sha256').update(id).digest();
    const words: string[] = [];
    for (let i = 0; i < 3; i++) {
        words.push(WORD_POOL[hash[i] % WORD_POOL.length]);
    }
    return words.join('-');
}

function displayId(alarm: Alarm): string {
    if (alarm.id.length < 20) return alarm.id;
    return `${alarm.shortId} (${alarm.id.slice(0, 20)}...)`;
}

function cleanFields(fields: AlarmFields): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        out[key] = inspect(value);
    }
    return out;
}

// -- AlarmClient ------------------------------------------------------

/**
 * Manages system alarms and routes them to alert transports by severity.
 *
 * Severity is the routing decision: each transport declares the severity window
 * it accepts, so `critical` pages on-call while `info` only reaches the chat
 * channel. Config can retier or mute any alarm id after the fact — see
 * `pager.severityOverrides` in {@link IConfig}.
 */
export class AlarmClient extends PuterClient {
    private alarms = new Map<string, Alarm>();
    private aliases = new Map<string, Alarm>();
    private alertHandlers: RegisteredHandler[] = [];
    private knownErrors: KnownErrorRule[] = [];
    private draining = false;
    private drainLogged = false;

    constructor(config: IConfig) {
        super(config);
    }

    // -- Lifecycle ----------------------------------------------------

    override async onServerStart(): Promise<void> {
        const paging = this.registerPagerDuty();
        this.registerSlack({ paging });
    }

    override onServerPrepareShutdown(): void {
        if (this.draining) return;
        this.draining = true;
        console.log('[alarm] entering drain mode — suppressing new alarms');
    }

    /** @returns Whether a working PagerDuty transport was registered. */
    private registerPagerDuty(): boolean {
        const pagerDutyConf = this.config.pager?.pagerduty;
        if (!pagerDutyConf?.enabled) return false;

        const routingKey = pagerDutyConf.routingKey;
        if (!routingKey) {
            console.warn(
                '[alarm] PagerDuty enabled but no routingKey configured',
            );
            return false;
        }

        const serverId = this.config.serverId;
        const minSeverity =
            pagerDutyConf.minSeverity ?? DEFAULT_PAGERDUTY_MIN_SEVERITY;

        this.addAlertHandler(
            async (alert) => {
                await pdEvent({
                    data: {
                        routing_key: routingKey,
                        event_action: 'trigger',
                        dedup_key: alert.dedupKey,
                        payload: {
                            summary: alert.message,
                            source: alert.source,
                            severity: alert.severity,
                            custom_details: {
                                ...alert.custom,
                                server_id: serverId,
                            },
                        },
                    },
                });
            },
            { name: 'pagerduty', minSeverity },
        );

        console.log(
            `[alarm] PagerDuty handler registered (min severity: ${minSeverity})`,
        );
        return true;
    }

    private registerSlack({ paging }: { paging: boolean }): void {
        const slackConf = this.config.pager?.slack;
        if (!slackConf?.enabled) return;

        if (!slackConf.webhookUrl) {
            console.warn('[alarm] Slack enabled but no webhookUrl configured');
            return;
        }

        const minSeverity = slackConf.minSeverity ?? 'info';
        // With a pager taking everything from `warning` up, chat is where the
        // rest is recorded — reposting the paging tiers there only trains
        // people to skim the channel. Without one, Slack is the only place an
        // alarm can land, so it takes all of them.
        const maxSeverity =
            slackConf.maxSeverity ??
            (paging ? DEFAULT_SLACK_MAX_SEVERITY_WITH_PAGER : 'critical');

        this.addAlertHandler(
            createSlackAlertHandler(slackConf, {
                serverId: this.config.serverId,
            }),
            { name: 'slack', minSeverity, maxSeverity },
        );

        console.log(
            `[alarm] Slack handler registered (severity ${minSeverity}..${maxSeverity})`,
        );
    }

    // -- Public API ---------------------------------------------------

    /**
     * Create or update an alarm. If the alarm ID already exists, the occurrence
     * count is incremented and a repeat alert is dispatched.
     *
     * `severity` decides where the alarm lands:
     *
     * Critical — a real outage; pages on-call. Reserve it for unhandled server
     * errors. error — pages on-call as well; prefer `critical` or `warning`.
     * warning — worth a look soon, but nobody gets woken up. info — a record in
     * the chat channel; never pages.
     *
     * Omit it to take `pager.defaultSeverity` (itself defaulting to
     * 'critical'). Operators can retier or mute any alarm id from config
     * afterwards, so the value here is the starting point, not the last word.
     *
     * Pass `{ dedup: true }` when repeats of this id are one recurring fault
     * that should collapse into a single incident — see {@link AlarmOptions}.
     */
    create(
        id: string,
        message: string,
        fields: AlarmFields = {},
        severity?: PagerSeverity,
        opts: AlarmOptions = {},
    ): void {
        if (this.draining) {
            if (!this.drainLogged) {
                this.drainLogged = true;
                console.log('[alarm] suppressing alarm while draining');
            }
            return;
        }

        const existing = this.alarms.get(id);

        if (existing) {
            this.recordOccurrence(existing, message, fields);
            this.handleRepeat(existing);
            return;
        }

        const alarm: Alarm = {
            id,
            shortId: shortId(id),
            message,
            fields,
            severity,
            dedup: opts.dedup,
            started: Date.now(),
            // `recordOccurrence` below stamps the first occurrence; seeding one
            // here too would report every alarm as one occurrence ahead.
            count: 0,
            timestamps: [],
            occurrences: [],
        };
        if (fields.error) alarm.error = fields.error;

        this.alarms.set(id, alarm);
        this.aliases.set(alarm.shortId, alarm);
        this.recordOccurrence(alarm, message, fields);
        this.handleNew(alarm);
    }

    /** Clear an active alarm. */
    clear(id: string): void {
        const alarm = this.alarms.get(id);
        if (!alarm) return;

        this.alarms.delete(id);
        this.aliases.delete(alarm.shortId);
        console.log(`[alarm] CLEAR ${displayId(alarm)} :: ${alarm.message}`);
    }

    /** Look up an alarm by its full ID or short ID. */
    get(id: string): Alarm | undefined {
        return this.alarms.get(id) ?? this.aliases.get(id);
    }

    /**
     * Register an additional alert handler. Handlers are called for every alarm
     * that isn't suppressed by a known-error rule or muted by config, and whose
     * severity falls inside the handler's own `minSeverity`..`maxSeverity`
     * window (default: everything).
     */
    addAlertHandler(
        handler: AlertHandler,
        opts: {
            name?: string;
            minSeverity?: PagerSeverity;
            maxSeverity?: PagerSeverity;
        } = {},
    ): void {
        this.alertHandlers.push({
            name: opts.name ?? `handler-${this.alertHandlers.length}`,
            minSeverity: opts.minSeverity ?? 'info',
            maxSeverity: opts.maxSeverity ?? 'critical',
            handler,
        });
    }

    /** Add rules that can suppress or adjust severity of known errors. */
    setKnownErrors(rules: KnownErrorRule[]): void {
        this.knownErrors = rules;
    }

    // -- Internals ----------------------------------------------------

    private recordOccurrence(
        alarm: Alarm,
        message: string,
        fields: AlarmFields,
    ): void {
        const now = Date.now();
        alarm.message = message;
        alarm.fields = { ...alarm.fields, ...fields };
        alarm.count++;
        if (fields.error) alarm.error = fields.error;

        alarm.timestamps.push(now);
        alarm.occurrences.push({ message, fields, timestamp: now });

        if (alarm.timestamps.length > OCCURRENCE_HISTORY_LIMIT) {
            alarm.timestamps.splice(
                0,
                alarm.timestamps.length - OCCURRENCE_HISTORY_LIMIT,
            );
            alarm.occurrences.splice(
                0,
                alarm.occurrences.length - OCCURRENCE_HISTORY_LIMIT,
            );
        }
    }

    private applyKnownErrors(alarm: Alarm): void {
        for (const rule of this.knownErrors) {
            if (!this.ruleMatches(rule, alarm)) continue;

            switch (rule.action.type) {
                case 'no-alert':
                    alarm.noAlert = true;
                    break;
                case 'severity':
                    alarm.severity = rule.action.value;
                    break;
            }
        }
    }

    private ruleMatches(rule: KnownErrorRule, alarm: Alarm): boolean {
        const { match } = rule;
        if (match.id !== alarm.id) return false;
        if (match.message && match.message !== alarm.message) return false;
        if (match.fields) {
            for (const [key, value] of Object.entries(match.fields)) {
                if (alarm.fields[key] !== value) return false;
            }
        }
        return true;
    }

    private handleNew(alarm: Alarm): void {
        this.applyKnownErrors(alarm);

        console.error(`[alarm] ACTIVE ${displayId(alarm)} :: ${alarm.message}`);

        if (alarm.error) {
            console.error(alarm.error);
        }

        if (alarm.noAlert) return;

        this.dispatchAlert(alarm);
    }

    private handleRepeat(alarm: Alarm): void {
        this.applyKnownErrors(alarm);

        console.warn(
            `[alarm] REPEAT ${displayId(alarm)} :: ${alarm.message} (${alarm.count})`,
        );

        if (alarm.noAlert) return;

        this.dispatchAlert(alarm);
    }

    /**
     * Call-site severity, then any known-error rule (both already on the
     * alarm), then the config override — so an operator always has the last
     * word over what the code asked for.
     */
    private resolveSeverity(alarm: Alarm): SeverityRule {
        const base =
            alarm.severity ??
            this.config.pager?.defaultSeverity ??
            FALLBACK_SEVERITY;
        return (
            resolveSeverityOverride(
                alarm.id,
                this.config.pager?.severityOverrides,
            ) ?? base
        );
    }

    private dispatchAlert(alarm: Alarm): void {
        const resolved = this.resolveSeverity(alarm);
        if (resolved === 'mute') {
            if (!alarm.muteLogged) {
                alarm.muteLogged = true;
                console.log(`[alarm] MUTED by config ${displayId(alarm)}`);
            }
            return;
        }
        alarm.severity = resolved;

        const fieldsClean = cleanFields(alarm.fields);
        const repeatCount = alarm.count;

        const id = alarm.id || 'something-bad';

        const payload: AlertPayload = {
            id,
            // A de-duplicating transport should fold repeats of a recurring
            // fault into one incident, but everything else is a fresh event
            // each time it fires — the start time keeps occurrence numbering
            // from colliding with an incident left open by an earlier boot.
            dedupKey: alarm.dedup
                ? id
                : `${id}#${alarm.started}.${repeatCount}`,
            shortId: alarm.shortId,
            message: alarm.message || alarm.id || 'something bad happened',
            source: 'alarm',
            severity: resolved,
            fields: fieldsClean,
            trace: alarm.error?.stack,
            repeatCount,
            isRepeat: repeatCount > 1,
            custom: {
                fields: fieldsClean,
                trace: alarm.error?.stack,
                repeat_count: repeatCount,
            },
        };

        for (const { name, minSeverity, maxSeverity, handler } of this
            .alertHandlers) {
            if (!meetsMinSeverity(resolved, minSeverity)) continue;
            if (!withinMaxSeverity(resolved, maxSeverity)) continue;
            handler(payload).catch((err) => {
                console.error(
                    `[alarm] ${name} alert handler failed: ${err?.message}`,
                );
            });
        }
    }
}
