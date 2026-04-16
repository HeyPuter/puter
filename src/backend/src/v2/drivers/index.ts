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
import { EntriDriver } from './entri/EntriDriver';
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
    entri: EntriDriver,
    workers: WorkerDriver,
} satisfies IPuterDriverRegistry;