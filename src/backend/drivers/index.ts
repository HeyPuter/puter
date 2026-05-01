/**
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

import type { IPuterDriverRegistry } from './types';
import { ChatCompletionDriver } from './ai-chat/ChatCompletionDriver';
import { ImageGenerationDriver } from './ai-image/ImageGenerationDriver';
import { TTSDriver } from './ai-tts/TTSDriver';
import { VideoGenerationDriver } from './ai-video/VideoGenerationDriver';
import { VoiceChangerDriver } from './ai-speech2speech/VoiceChangerDriver';
import { SpeechToTextDriver } from './ai-speech2txt/SpeechToTextDriver';
import { OCRDriver } from './ai-ocr/OCRDriver';
import { AppDriver } from './apps/AppDriver.js';
import { KVStoreDriver } from './kv/KVStoreDriver';
import { NotificationDriver } from './notification/NotificationDriver';
import { SubdomainDriver } from './subdomain/SubdomainDriver';
import { WorkerDriver } from './workers/WorkerDriver';

export { resolveDriverMeta } from './meta';
export { Driver } from './decorators';

export const puterDrivers = {
    kvStore: KVStoreDriver,
    aiChat: ChatCompletionDriver,
    aiImage: ImageGenerationDriver,
    aiTts: TTSDriver,
    aiVideo: VideoGenerationDriver,
    aiSpeech2Speech: VoiceChangerDriver,
    aiSpeech2Txt: SpeechToTextDriver,
    aiOcr: OCRDriver,
    apps: AppDriver,
    subdomains: SubdomainDriver,
    notifications: NotificationDriver,
    workers: WorkerDriver,
} satisfies IPuterDriverRegistry;
