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

import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import type { IConfig, PagerSeverity, SeverityRule } from '../../types';
import { PuterClient } from '../types';
import {
    meetsMinSeverity,
    resolveCallGroup,
    resolveSeverityOverride,
    withinMaxSeverity,
} from './severity';
import { createPagerDutyAlertHandler } from './pagerduty';
import { createSlackAlertHandler } from './slack';
import type {
    Alarm,
    AlarmCall,
    AlarmFields,
    AlarmOptions,
    AlertDelivery,
    AlertHandler,
    AlertPayload,
    CallHandler,
    KnownErrorRule,
} from './types';

export type {
    Alarm,
    AlarmCall,
    AlarmFields,
    AlarmOptions,
    AlertDelivery,
    AlertHandler,
    AlertPayload,
    CallHandler,
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
 * How many recent occurrences an alarm keeps. A hot alarm repeats for as long
 * as the fault lasts, so retaining every occurrence means retaining every
 * message and field set it was ever raised with, request bodies and actors
 * included. The last few are what a human reads; the rest is only a count, and
 * `count` keeps that.
 */
const OCCURRENCE_HISTORY_LIMIT = 20;
/**
 * An alarm that hasn't recurred for this long is forgotten; its next occurrence
 * is a new alarm with a fresh count. Kept far past the chat transport's repeat
 * throttle so a slowly recurring fault still counts as one alarm.
 */
export const ALARM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Most alarms held at once. Ids that embed a user or key can outrun the idle
 * window; past this the least recently raised alarm is dropped.
 */
export const MAX_TRACKED_ALARMS = 1000;

// A fast-recurring fault repeats far faster than it is useful to report, and
// every report allocates a log line and a payload. Report every occurrence up
// to the burst, then one per interval; `count` still tracks all of them.
const REPEAT_REPORT_BURST = 10;
const REPEAT_REPORT_INTERVAL = 500;

const shouldReportRepeat = (count: number): boolean =>
    count <= REPEAT_REPORT_BURST || count % REPEAT_REPORT_INTERVAL === 0;
/** How often an unreported repeat re-sends its alarm's open call. */
const CALL_REFRESH_MS = 60 * 1000;
/** Longest a call waits on transports for links before it goes out without. */
const CALL_LINK_WAIT_MS = 15 * 1000;
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
 * it accepts, so `critical` pages on-call while `info` only reaches chat, where
 * the alarm's `channel` key picks the channel. Config can retier or mute any
 * alarm id after the fact (`pager.severityOverrides` in {@link IConfig}), and
 * can mark ids that phone someone (`pager.calls`).
 */
export class AlarmClient extends PuterClient {
    /** Ordered by last occurrence: a repeat moves its alarm to the back. */
    private alarms = new Map<string, Alarm>();
    private aliases = new Map<string, Alarm>();
    private alertHandlers: RegisteredHandler[] = [];
    private callHandlers: CallHandler[] = [];
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

        const minSeverity =
            pagerDutyConf.minSeverity ?? DEFAULT_PAGERDUTY_MIN_SEVERITY;

        this.addAlertHandler(
            createPagerDutyAlertHandler({
                routingKey,
                apiToken: pagerDutyConf.apiToken,
                serverId: this.config.serverId,
            }),
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

        if (!slackConf.botToken && !slackConf.webhookUrl) {
            console.warn(
                '[alarm] Slack enabled but no botToken or webhookUrl configured',
            );
            return;
        }
        if (slackConf.botToken && !slackConf.channel) {
            console.warn('[alarm] Slack botToken needs a default channel');
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
     * count is incremented and a repeat alert is dispatched. An alarm idle for
     * {@link ALARM_IDLE_TTL_MS} is forgotten, so its next occurrence is new.
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
     * that should collapse into a single incident, and `channel` to post it to
     * the chat channel of the area that owns it — see {@link AlarmOptions}.
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

        this.evict();
        const existing = this.alarms.get(id);

        if (existing) {
            this.alarms.delete(id);
            this.alarms.set(id, existing);
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
            channel: opts.channel,
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
        this.evict();
        this.handleNew(alarm);
    }

    /** Clear an active alarm. */
    clear(id: string): void {
        const alarm = this.alarms.get(id);
        if (!alarm) return;

        this.forget(alarm);
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

    /**
     * Register a handler for alarms `pager.calls.rules` says phone someone. It
     * runs once the transports that took the alarm settle, with the links they
     * returned. Call groups aren't resolved until one is registered.
     */
    addCallHandler(handler: CallHandler): void {
        this.callHandlers.push(handler);
    }

    /** Add rules that can suppress or adjust severity of known errors. */
    setKnownErrors(rules: KnownErrorRule[]): void {
        this.knownErrors = rules;
    }

    // -- Internals ----------------------------------------------------

    /**
     * Drop idle alarms, then the least recently raised ones past the cap. The
     * map's order puts both at the front, so this stops at the first keeper.
     */
    private evict(): void {
        const now = Date.now();
        for (const alarm of this.alarms.values()) {
            const lastSeen = alarm.timestamps.at(-1) ?? alarm.started;
            if (
                this.alarms.size <= MAX_TRACKED_ALARMS &&
                now - lastSeen < ALARM_IDLE_TTL_MS
            ) {
                return;
            }
            this.forget(alarm);
        }
    }

    private forget(alarm: Alarm): void {
        this.alarms.delete(alarm.id);
        // Short ids can collide; leave an alias that now names another alarm.
        if (this.aliases.get(alarm.shortId) === alarm) {
            this.aliases.delete(alarm.shortId);
        }
    }

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

        if (!shouldReportRepeat(alarm.count)) {
            // Too frequent to report, but still firing: keep its call open.
            if (alarm.call && !alarm.noAlert) this.refreshCall(alarm);
            return;
        }

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

    private hasHandlerFor(severity: PagerSeverity): boolean {
        for (const { minSeverity, maxSeverity } of this.alertHandlers) {
            if (
                meetsMinSeverity(severity, minSeverity) &&
                withinMaxSeverity(severity, maxSeverity)
            ) {
                return true;
            }
        }
        return false;
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

        const callGroup =
            this.callHandlers.length > 0
                ? resolveCallGroup(alarm.id, this.config.pager?.calls?.rules)
                : undefined;

        // Build nothing for an alarm nothing takes — the payload (cleaned
        // fields plus the stack, twice) is the expensive part.
        if (!callGroup && !this.hasHandlerFor(resolved)) return;

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
            ...(alarm.channel ? { channel: alarm.channel } : {}),
            ...(callGroup ? { callGroup } : {}),
            custom: {
                fields: fieldsClean,
                trace: alarm.error?.stack,
                repeat_count: repeatCount,
            },
        };

        const deliveries: Promise<AlertDelivery | undefined>[] = [];
        for (const registered of this.alertHandlers) {
            if (!meetsMinSeverity(resolved, registered.minSeverity)) continue;
            if (!withinMaxSeverity(resolved, registered.maxSeverity)) continue;
            deliveries.push(deliver(registered, payload));
        }

        if (callGroup)
            void this.raiseCall(alarm, payload, callGroup, deliveries);
    }

    /** A throttled repeat returns no link, so the last call's links carry over. */
    private async raiseCall(
        alarm: Alarm,
        alert: AlertPayload,
        group: string,
        deliveries: Promise<AlertDelivery | undefined>[],
    ): Promise<void> {
        const links: string[] = [];
        const collected = deliveries.map(async (delivery) => {
            const url = (await delivery)?.url;
            if (url) links.push(url);
        });
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
            Promise.all(collected),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, CALL_LINK_WAIT_MS);
                timer.unref?.();
            }),
        ]);
        clearTimeout(timer);

        const call: AlarmCall = {
            group,
            alert,
            links: links.length > 0 ? [...links] : (alarm.call?.links ?? []),
        };
        alarm.call = call;
        await this.notifyCallHandlers(alarm, call);
    }

    private refreshCall(alarm: Alarm): void {
        const { call, callAt = 0 } = alarm;
        if (!call || Date.now() - callAt < CALL_REFRESH_MS) return;
        void this.notifyCallHandlers(alarm, {
            ...call,
            alert: { ...call.alert, repeatCount: alarm.count, isRepeat: true },
        });
    }

    private async notifyCallHandlers(
        alarm: Alarm,
        call: AlarmCall,
    ): Promise<void> {
        alarm.callAt = Date.now();
        await Promise.all(
            this.callHandlers.map(async (handler) => {
                try {
                    await handler(call);
                } catch (err) {
                    console.error(
                        `[alarm] call handler failed for ${displayId(alarm)}: ${(err as Error)?.message}`,
                    );
                }
            }),
        );
    }
}

/** Run one transport; a failure is logged and never reaches the others. */
async function deliver(
    { name, handler }: RegisteredHandler,
    payload: AlertPayload,
): Promise<AlertDelivery | undefined> {
    try {
        return (await handler(payload)) as AlertDelivery | undefined;
    } catch (err) {
        console.error(
            `[alarm] ${name} alert handler failed: ${(err as Error)?.message}`,
        );
    }
}
