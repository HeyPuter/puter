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

import type { IChatModel, ICompleteArguments } from '../types.js';

type ResponseSamplingParams = Pick<
    ICompleteArguments,
    'temperature' | 'top_p' | 'include'
>;

export const responseSamplingParams = (
    model: Pick<IChatModel, 'responsesSampling'>,
    params: ResponseSamplingParams,
    reasoningEffort: string | undefined,
): ResponseSamplingParams => {
    const supportsSampling =
        (reasoningEffort === undefined || reasoningEffort === 'none') &&
        (model.responsesSampling === undefined ||
            (model.responsesSampling === 'reasoningDisabled' &&
                reasoningEffort === 'none'));
    const include = supportsSampling
        ? params.include
        : params.include?.filter(
              (value) => value !== 'message.output_text.logprobs',
          );
    return {
        ...(supportsSampling && params.temperature !== undefined
            ? { temperature: params.temperature }
            : {}),
        ...(supportsSampling && params.top_p !== undefined
            ? { top_p: params.top_p }
            : {}),
        ...(include !== undefined ? { include } : {}),
    };
};
