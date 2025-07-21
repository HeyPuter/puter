import { NORMALIZED_LLM_MESSAGES, NORMALIZED_LLM_PARAMS, NORMALIZED_LLM_TOOLS } from "./types.js"

export default define => {
    define.howToGet(NORMALIZED_LLM_TOOLS).from(NORMALIZED_LLM_PARAMS).as(x => {
        return x.get(NORMALIZED_LLM_PARAMS).tools;
    })
    define.howToGet(NORMALIZED_LLM_MESSAGES).from(NORMALIZED_LLM_PARAMS).as(x => {
        return x.get(NORMALIZED_LLM_PARAMS).messages;
    })
}
