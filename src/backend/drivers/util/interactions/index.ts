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
 * OpenAI <-> Gemini Interactions translation.
 *
 * Google's Interactions API is the single endpoint behind Gemini models,
 * agents, and Omni video. It is not chat-completions shaped, and Puter
 * normalises every chat upstream to chat-completions. This module is the seam:
 * it speaks Interactions on one side and chat-completions on the other, so
 * adopting an Interactions-only model is a provider plus a catalog entry
 * instead of a new response path through the driver.
 *
 * Lives under `drivers/util` rather than `ai-chat/utils` because the video
 * driver needs the same translation for Omni.
 */

export {
    messagesToInteractionsInput,
    toGenerationConfig,
    toolsToInteractionsTools,
    type IGenerationConfigArgs,
    type IInteractionsInput,
} from './request.js';

export {
    INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS,
    interactionStreamToChunks,
    interactionToCompletion,
    interactionUsageToOpenAI,
    partitionOutputs,
    type IPartitionedOutputs,
} from './response.js';

export type {
    IOpenAIChoice,
    IOpenAIChunk,
    IOpenAIChunkDelta,
    IOpenAICompletion,
    IOpenAIMessage,
    IOpenAIToolCall,
    IOpenAIUsage,
    OpenAIChatMessage,
} from './types.js';
