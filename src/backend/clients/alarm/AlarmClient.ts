import { event as pdEvent } from '@pagerduty/pdjs';
import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import type { IConfig } from '../../types';
import { PuterClient } from '../types';

// ── Types ────────────────────────────────────────────────────────────

export interface AlarmFields {
    error?: Error;
    [key: string]: unknown;
}

interface AlarmOccurrence {
    message: string;
    fields: AlarmFields;
    timestamp: number;
}

interface Alarm {
    id: string;
    shortId: string;
    message: string;
    fields: AlarmFields;
    error?: Error;
    started: number;
    timestamps: number[];
    occurrences: AlarmOccurrence[];
    severity?: PagerSeverity;
    noAlert?: boolean;
}

type PagerSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface AlertPayload {
    id: string;
    message: string;
    source: string;
    severity: PagerSeverity;
    custom?: Record<string, unknown>;
}

type AlertHandler = (alert: AlertPayload) => Promise<void>;

interface KnownErrorRule {
    match: {
        id: string;
        message?: string;
        fields?: Record<string, unknown>;
    };
    action: {
        type: 'no-alert' | 'severity';
        value?: PagerSeverity;
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Deterministic short identifier derived from an alarm ID.
 * Produces a readable 3-word slug like "amber-delta-fox".
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

// ── AlarmClient ──────────────────────────────────────────────────────

/**
 * Manages system alarms and dispatches alerts to external paging
 * services (PagerDuty, or any registered handler).
 */
export class AlarmClient extends PuterClient {
    private alarms = new Map<string, Alarm>();
    private aliases = new Map<string, Alarm>();
    private alertHandlers: AlertHandler[] = [];
    private knownErrors: KnownErrorRule[] = [];
    private draining = false;
    private drainLogged = false;

    constructor(config: IConfig) {
        super(config);
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    override async onServerStart(): Promise<void> {
        const pagerConf = this.config.pager;
        if (!pagerConf?.pagerduty?.enabled) return;

        const routingKey = pagerConf.pagerduty.routingKey;
        if (!routingKey) {
            console.warn(
                '[alarm] PagerDuty enabled but no routingKey configured',
            );
            return;
        }

        const serverId = this.config.serverId;

        this.alertHandlers.push(async (alert) => {
            await pdEvent({
                data: {
                    routing_key: routingKey,
                    event_action: 'trigger',
                    dedup_key: alert.id,
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
        });

        console.log('[alarm] PagerDuty handler registered');
    }

    override onServerPrepareShutdown(): void {
        if (this.draining) return;
        this.draining = true;
        console.log('[alarm] entering drain mode — suppressing new alarms');
    }

    // ── Public API ───────────────────────────────────────────────────

    /**
     * Create or update an alarm. If the alarm ID already exists, the
     * occurrence count is incremented and a repeat alert is dispatched.
     */
    create(id: string, message: string, fields: AlarmFields = {}): void {
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
            started: Date.now(),
            timestamps: [Date.now()],
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
     * Register an additional alert handler. Handlers are called for
     * every alarm that isn't suppressed by a known-error rule.
     */
    addAlertHandler(handler: AlertHandler): void {
        this.alertHandlers.push(handler);
    }

    /**
     * Add rules that can suppress or adjust severity of known errors.
     */
    setKnownErrors(rules: KnownErrorRule[]): void {
        this.knownErrors = rules;
    }

    // ── Internals ────────────────────────────────────────────────────

    private recordOccurrence(
        alarm: Alarm,
        message: string,
        fields: AlarmFields,
    ): void {
        alarm.message = message;
        alarm.fields = { ...alarm.fields, ...fields };
        alarm.timestamps.push(Date.now());
        if (fields.error) alarm.error = fields.error;

        alarm.occurrences.push({
            message,
            fields,
            timestamp: Date.now(),
        });
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
            `[alarm] REPEAT ${displayId(alarm)} :: ${alarm.message} (${alarm.timestamps.length})`,
        );

        if (alarm.noAlert) return;

        this.dispatchAlert(alarm);
    }

    private dispatchAlert(alarm: Alarm): void {
        const severity = alarm.severity ?? 'critical';
        const fieldsClean = cleanFields(alarm.fields);

        const payload: AlertPayload = {
            id: alarm.id || 'something-bad',
            message: alarm.message || alarm.id || 'something bad happened',
            source: 'alarm',
            severity,
            custom: {
                fields: fieldsClean,
                trace: alarm.error?.stack,
                repeat_count: alarm.timestamps.length,
            },
        };

        for (const handler of this.alertHandlers) {
            handler(payload).catch((err) => {
                console.error(`[alarm] alert handler failed: ${err?.message}`);
            });
        }
    }
}
