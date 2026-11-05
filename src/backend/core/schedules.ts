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
 * What core asks of schedules. Nothing here is an implementation: an extension
 * registers `services.schedules`, and a server without one answers every
 * schedule route and `notify({ sendAt })` with `events_disabled`. Called by
 * extensions; keep these signatures stable.
 */

import type { EventsDeployOutcome } from '../controllers/events/workerDeploy.js';
import type { AppMessage } from '../services/notification/appMessage.js';
import type { SuspendedReason } from '../stores/events/DurableSubscriptionStore.js';
import type { DurableSubscription } from '../stores/events/types.js';
import type { PageResult } from '../util/pagination.js';
import type { Actor } from './actor.js';
import { HttpError } from './http/HttpError.js';

/** Why a schedule ended. */
export type ScheduleEndReason =
    | 'removed'
    | 'ended'
    | 'app_deleted'
    | 'uninstalled'
    | 'permission_revoked'
    | 'holder_gone'
    | 'app_gone'
    | 'orphaned'
    | 'delivered'
    | 'dropped';

/** What happened to a set of subscription rows schedules own. */
export type ScheduleSubscriptionChange =
    | {
          type: 'suspended';
          reason: SuspendedReason;
          /** For a reason that never lifts; defaults to that reason. */
          endReason?: ScheduleEndReason;
      }
    | { type: 'resumed' }
    | { type: 'ended'; endReason: ScheduleEndReason };

/** A schedule that keeps running, one that runs once, or a delayed notification. */
export type ScheduleViewKind = 'recurring' | 'once' | 'deferred';

/**
 * A schedule as its holder sees it. Times are epoch ms. `context` values are
 * never returned, as for a persistent subscription: only its keys and a hash.
 */
export interface ScheduleView {
    scheduleId: string;
    kind: ScheduleViewKind;
    appUid: string;
    /** `null` once ended: the handler binding goes with the schedule. */
    handlerName: string | null;
    /** Set only when the handler lives in the holder's own scope. */
    handlerScope?: 'user';
    contextKeys: string[] | null;
    contextHash: string | null;
    /** Interval of an `every` schedule. */
    every: number | null;
    cron: string | null;
    tz: string;
    /** First allowed run; a one-shot's only run. */
    startAt: number;
    /** Last allowed run, inclusive. */
    endsAt: number | null;
    /** `sending` once a delayed send has started; it can't be cancelled then. */
    state: 'active' | 'suspended' | 'sending' | 'ended';
    suspendedReason: string | null;
    endReason: string | null;
    endedAt: number | null;
    /**
     * The slot it runs for next; `null` while suspended or sending, and once
     * ended.
     */
    nextRunAt: number | null;
    createdAt: number;
}

export interface ScheduleListRequest {
    limit: number;
    cursor?: string;
    includeTotal: boolean;
}

/** The caps a holder's schedules are held to, from their plan. */
export interface ScheduleQuota {
    recurringPerUser: number;
    recurringPerApp: number;
    oneShotsPerUser: number;
    oneShotsPerApp: number;
    /** Worst-case runs per hour × 1000, summed over recurring rows. */
    budgetPerUser: number;
    budgetPerApp: number;
}

/** A caller cleared to supply `sendAt`, and when it asked for. */
export interface DeferredSendPlan {
    sendAt: number;
    /** Due within 5 seconds, or past: sent now rather than stored. */
    immediate: boolean;
    holderUserId: number;
    appUid: string;
    handlerDepth: number;
    quota: ScheduleQuota;
}

/** What a delayed app message stores until it is sent. */
export interface DeferredAppMessage {
    message: AppMessage;
    /** A KV share handle naming the recipient. */
    to?: string;
}

/**
 * A condition on one row of another table that statements embed as `EXISTS
 * (SELECT 1 FROM <table> WHERE <where>)`, binding `values`.
 */
export interface SqlGuard {
    table: string;
    where: string;
    values: unknown[];
}

/** Ceiling of a schedule listing page. */
export const SCHEDULE_LIST_LIMIT_CAP = 200;

/** The signed peer route a region's schedule changes are sent to. */
export const SCHEDULE_PEER_PATH = '/broadcast/events/schedules';

export const schedulesUnavailable = (): HttpError =>
    new HttpError(503, 'Schedules are not available on this server', {
        legacyCode: 'events_disabled',
        // The designed answer of a server without schedules, not a fault.
        noAlarm: true,
    });

export interface ScheduleServiceContract {
    /**
     * Keep schedules in step with a change to the subscription rows they own.
     * Never throws: the subscription change has already happened.
     */
    onSubscriptionsChanged(
        rows: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
    ): Promise<void>;
    createFor(
        actor: Actor,
        body: Record<string, unknown>,
    ): Promise<ScheduleView>;
    list(
        actor: Actor,
        request: ScheduleListRequest,
    ): Promise<PageResult<ScheduleView>>;
    get(actor: Actor, scheduleId: unknown): Promise<ScheduleView>;
    update(
        actor: Actor,
        scheduleId: unknown,
        changes: unknown,
    ): Promise<ScheduleView>;
    remove(actor: Actor, scheduleId: unknown): Promise<void>;
    /** `results`: each change's index outcome, in order (`null` if dropped). */
    receivePeerChanges(
        body: unknown,
    ): Promise<{ applied: number; results?: Array<number | null> }>;
    /** Checks a caller supplying `sendAt`; `events_disabled` when off. */
    prepareSendAt(actor: Actor, sendAt: unknown): Promise<DeferredSendPlan>;
    createDeferredAppMessage(
        plan: DeferredSendPlan,
        message: DeferredAppMessage,
    ): Promise<{ scheduleId: string; sendAt: number }>;
    /**
     * Runs an events worker deploy under the schedules' deploy gate; `capped`
     * for a schedule run's. A passthrough when schedules are off.
     */
    gateDeploy?(
        script: string,
        options: { capped: boolean },
        deploy: () => Promise<EventsDeployOutcome>,
    ): Promise<EventsDeployOutcome>;
}
