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

import {
    EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP,
    EVENTS_SCHEDULE_FIRE_BUDGET_PER_USER,
    EVENTS_SCHEDULE_MIN_INTERVAL_MS,
    EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
    EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_USER,
    EVENTS_SCHEDULES_PER_APP,
    EVENTS_SCHEDULES_PER_USER,
    limitFor,
} from '../../controllers/events/limits.js';
import {
    assertResolvedActor,
    handlerDepthOf,
    isAccessTokenActor,
    type Actor,
} from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    TERMINAL_SUSPENDED_REASONS,
    type SuspendedReason,
} from '../../stores/events/DurableSubscriptionStore.js';
import type {
    ScheduleEndReason,
    ScheduleQuota,
    ScheduleRow,
} from '../../stores/events/ScheduleStore.js';
import {
    isScheduleRow,
    type DurableSubscription,
} from '../../stores/events/types.js';
import type { IConfig } from '../../types.js';
import { actorPlanId } from '../metering/enforcement.js';
import { PuterService } from '../types.js';
import {
    validateScheduleRequest,
    type ScheduleRequest,
    type ScheduleSpec,
} from './scheduleOptions.js';

/**
 * Scheduled handlers: validating a create, and keeping schedule rows in step
 * with the subscription rows they own as those are suspended, resumed and
 * reaped.
 */

/** What happened to a set of subscription rows. */
export type ScheduleSubscriptionChange =
    | {
          type: 'suspended';
          reason: SuspendedReason;
          /** For a reason that never lifts; defaults to that reason. */
          endReason?: ScheduleEndReason;
      }
    | { type: 'resumed' }
    | { type: 'ended'; endReason: ScheduleEndReason };

/** A validated create, with who it is for and the caps it is held to. */
export interface SchedulePlan extends ScheduleSpec {
    namespace: string;
    holderUserId: number;
    appUid: string;
    handlerDepth: number;
    quota: ScheduleQuota;
}

/** The deployment namespace schedule rows are written and read under. */
export const scheduleNamespace = (config: IConfig): string =>
    config.jobs?.namespace ?? config.domain ?? 'default';

const disabled = (): HttpError =>
    new HttpError(503, 'Schedules are not enabled on this server', {
        legacyCode: 'events_disabled',
    });

const appRequired = (): HttpError =>
    new HttpError(403, 'A schedule must be created by an app', {
        legacyCode: 'events_schedule_app_required',
    });

/** As for persistent subscriptions: a scoped token is not the app. */
const scopedToken = (): HttpError =>
    new HttpError(403, 'A scoped access token may not hold schedules', {
        legacyCode: 'events_durable_requires_account',
    });

const temporaryAccount = (): HttpError =>
    new HttpError(403, 'A temporary account may not hold schedules', {
        legacyCode: 'events_durable_requires_account',
    });

const endFor = (
    change: ScheduleSubscriptionChange,
): { reason: ScheduleEndReason } | null => {
    if (change.type === 'ended') return { reason: change.endReason };
    if (
        change.type === 'suspended' &&
        TERMINAL_SUSPENDED_REASONS.includes(change.reason)
    )
        return { reason: change.endReason ?? 'permission_revoked' };
    return null;
};

export class ScheduleService extends PuterService {
    get enabled(): boolean {
        return (
            this.config.events?.enabled === true &&
            this.config.events?.schedules?.enabled === true
        );
    }

    get namespace(): string {
        return scheduleNamespace(this.config);
    }

    /**
     * Check a create against the caller and their plan, and compute what is
     * stored. A schedule belongs to an app and runs its published handler, so
     * an account-context caller or a scoped token is refused.
     */
    async prepareCreate(
        actor: Actor,
        request: ScheduleRequest,
        now: number = Date.now(),
    ): Promise<SchedulePlan> {
        if (!this.enabled) throw disabled();
        const holderUserId = actor.user?.id;
        if (holderUserId === undefined) throw disabled();
        assertResolvedActor(actor);
        const appUid = actor.effectiveApp?.uid;
        if (!appUid) throw appRequired();
        if (isAccessTokenActor(actor)) throw scopedToken();

        const plan = await actorPlanId(this.services.metering, actor);
        const quota: ScheduleQuota = {
            recurringPerUser: limitFor(EVENTS_SCHEDULES_PER_USER, plan),
            recurringPerApp: limitFor(EVENTS_SCHEDULES_PER_APP, plan),
            oneShotsPerUser: limitFor(
                EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_USER,
                plan,
            ),
            oneShotsPerApp: limitFor(
                EVENTS_SCHEDULE_PENDING_ONESHOTS_PER_APP,
                plan,
            ),
            budgetPerUser: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_USER, plan),
            budgetPerApp: limitFor(EVENTS_SCHEDULE_FIRE_BUDGET_PER_APP, plan),
        };
        if (quota.recurringPerUser === 0 && quota.oneShotsPerUser === 0)
            throw temporaryAccount();

        const spec = await validateScheduleRequest(request, {
            now,
            minIntervalMs: limitFor(EVENTS_SCHEDULE_MIN_INTERVAL_MS, plan),
        });
        await this.services.events.assertHandlerBinding(
            appUid,
            spec.handlerName,
            spec.handlerHash,
        );

        return {
            ...spec,
            namespace: this.namespace,
            holderUserId,
            appUid,
            handlerDepth: handlerDepthOf(actor),
            quota,
        };
    }

    /**
     * Keep schedule rows in step with a change to the subscription rows they
     * own. Called after the subscription change, from every path that makes
     * one; rows that aren't a schedule's are ignored. Never throws: the
     * subscription change has already happened, and a failed SQL step is
     * retried once and then left to the reconcile.
     */
    async onSubscriptionsChanged(
        rows: readonly DurableSubscription[],
        change: ScheduleSubscriptionChange,
    ): Promise<ScheduleRow[]> {
        const subIds = rows.filter(isScheduleRow).map((row) => row.subId);
        if (subIds.length === 0) return [];
        const end = endFor(change);
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.stores.schedule.applySubscriptionChange(
                    this.namespace,
                    subIds,
                    end,
                );
            } catch (err) {
                if (attempt >= 2) {
                    console.warn(
                        '[events] could not record a schedule lifecycle change',
                        change.type,
                        err,
                    );
                    return [];
                }
            }
        }
    }
}
