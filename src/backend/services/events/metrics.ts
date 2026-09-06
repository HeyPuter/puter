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

import { metrics } from '@opentelemetry/api';

/**
 * Counters for the cross-region forward path — which region a delivery went to,
 * whether the peer accepted it, and where a single-delivery attempt actually
 * landed. Attributes carry only region names and enum labels, never user data.
 */

const meter = metrics.getMeter('puter-backend');

/** Deliveries handed to a peer region, by class. */
export const forwardSent = meter.createCounter('events.forward.sent', {
    description: 'Deliveries queued for a peer region',
});

/** Batches a peer handed us, and what was in them. */
export const forwardReceived = meter.createCounter('events.forward.received', {
    description: 'Forwarded items accepted from a peer region',
});

/** One attempt at one owed `single` delivery, and where it went. */
export const singleAttempt = meter.createCounter('events.single.attempt', {
    description: 'Attempts at a single-delivery subscription, by target',
});

/**
 * What a forwarded session event found on the far side: `no-rows` is the
 * remote-watch index going stale (the token a peer announced is no longer
 * watched here), and is what drives a `noWatch` reply.
 */
export const sessionForward = meter.createCounter('events.session.forward', {
    description:
        'Forwarded session events, by whether the receiver matched one',
});
