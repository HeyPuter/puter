import type { IPuterDriverRegistry } from './types';
import { ChatCompletionDriver } from './ai-chat/ChatCompletionDriver';
import { ImageGenerationDriver } from './ai-image/ImageGenerationDriver';
import { TTSDriver } from './ai-tts/TTSDriver';
import { VideoGenerationDriver } from './ai-video/VideoGenerationDriver';
import { AppDriver } from './apps/AppDriver.js';
import { KVStoreDriver } from './kv/KVStoreDriver';

export { DriverRegistry, resolveDriverMeta } from './DriverRegistry';
export { Driver } from './decorators';

export const puterDrivers = {
    kvStore: KVStoreDriver,
    aiChat: ChatCompletionDriver,
    aiImage: ImageGenerationDriver,
    aiTts: TTSDriver,
    aiVideo: VideoGenerationDriver,
    apps: AppDriver,
} satisfies IPuterDriverRegistry;