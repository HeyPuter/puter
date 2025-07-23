import { NORMALIZED_LLM_PARAMS, PROVIDER_NAME, SYNC_RESPONSE } from "../airouter";

export default define => {
    define.howToGet(SYNC_RESPONSE).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) === 'myprovider')
    .as(async x => {
        //
    })
};
