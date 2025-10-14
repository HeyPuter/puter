import { AWS_POLLY_COST_MAP } from "./awsPollyCostMap";
import { AWS_TEXTRACT_COST_MAP } from "./awsTextractCostMap";
import { CLAUDE_COST_MAP } from "./claudeCostMap";
import { DEEPSEEK_COST_MAP } from "./deepSeekCostMap";
import { GEMINI_COST_MAP } from "./geminiCostMap";
import { GROQ_COST_MAP } from "./groqCostMap";
import { KV_COST_MAP } from "./kvCostMap";
import { MISTRAL_COST_MAP } from "./mistralCostMap";
import { OPENAI_COST_MAP } from "./openAiCostMap";
import { OPENAI_IMAGE_COST_MAP } from "./openaiImageCostMap";
import { OPENROUTER_COST_MAP } from "./openrouterCostMap";
import { TOGETHER_COST_MAP } from "./togetherCostMap";
import { XAI_COST_MAP } from "./xaiCostMap";

export const COST_MAPS = {
    ...AWS_POLLY_COST_MAP,
    ...AWS_TEXTRACT_COST_MAP,
    ...CLAUDE_COST_MAP,
    ...DEEPSEEK_COST_MAP,
    ...GEMINI_COST_MAP,
    ...GROQ_COST_MAP,
    ...KV_COST_MAP,
    ...MISTRAL_COST_MAP,
    ...OPENAI_COST_MAP,
    ...OPENAI_IMAGE_COST_MAP,
    ...OPENROUTER_COST_MAP,
    ...TOGETHER_COST_MAP,
    ...XAI_COST_MAP
}