import putility from "@heyputer/putility";

const { TTopics } = putility.traits;

/**
 * Manages the auth token and origin used to communicate with
 * Puter's API
 */
export class APIAccessService extends putility.concepts.Service {
    static TOPICS = ['update'];

    static PROPERTIES = {
        auth_token: {
            post_set (v) {
                this.as(TTopics).pub('update');
            }
        },
        api_origin: {
            post_set () {
                this.as(TTopics).pub('update');
            }
        },
    };

    // TODO: inconsistent! Update all dependents.
    get_api_info () {
        const self = this;
        const o = {};
        [
            ['auth_token','auth_token'],
            ['authToken','auth_token'],
            ['APIOrigin','api_origin'],
            ['api_origin','api_origin'],
        ].forEach(([k1,k2]) => {
            Object.defineProperty(o, k1, {
                get () {
                    return self[k2];
                },
                set (v) {
                    return self;
                }
            });
        });
        return o;
    }
}
