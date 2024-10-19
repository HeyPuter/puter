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
            post_set () {
                this.as(TTopics).pub('update');
            }
        },
        api_origin: {
            post_set () {
                this.as(TTopics).pub('update');
            }
        },
    };
}
