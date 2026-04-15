import { AWS_POLLY_COST_MAP } from './awsPollyCostMap.js';
import { AWS_TEXTRACT_COST_MAP } from './awsTextractCostMap.js';
import { CLAUDE_COST_MAP } from './claudeCostMap.js';
import { DEEPSEEK_COST_MAP } from './deepSeekCostMap.js';
import { FILE_SYSTEM_COST_MAP } from './fileSystemCostMap.js';
import { GEMINI_COST_MAP } from './geminiCostMap.js';
import { GROQ_COST_MAP } from './groqCostMap.js';
import { KV_COST_MAP } from './kvCostMap.js';
import { MISTRAL_COST_MAP } from './mistralCostMap.js';
import { OPENAI_COST_MAP } from './openAiCostMap.js';
import { OPENAI_IMAGE_COST_MAP } from './openaiImageCostMap.js';
import { OPENROUTER_COST_MAP } from './openrouterCostMap.js';
import { OPENAI_VIDEO_COST_MAP } from './openaiVideoCostMap.js';
import { TOGETHER_COST_MAP } from './togetherCostMap.js';
import { XAI_COST_MAP } from './xaiCostMap.js';
import { ELEVENLABS_COST_MAP } from './elevenlabsCostMap.js';

export const COST_MAPS = {
    ...AWS_POLLY_COST_MAP,
    ...AWS_TEXTRACT_COST_MAP,
    ...CLAUDE_COST_MAP,
    ...DEEPSEEK_COST_MAP,
    ...ELEVENLABS_COST_MAP,
    ...GEMINI_COST_MAP,
    ...GROQ_COST_MAP,
    ...KV_COST_MAP,
    ...MISTRAL_COST_MAP,
    ...OPENAI_COST_MAP,
    ...OPENAI_IMAGE_COST_MAP,
    ...OPENAI_VIDEO_COST_MAP,
    ...OPENROUTER_COST_MAP,
    ...TOGETHER_COST_MAP,
    ...XAI_COST_MAP,
    ...FILE_SYSTEM_COST_MAP,
};
