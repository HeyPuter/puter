// These utility functions describe how to produce an object safe
// for transfer that came from a "raw" object.

export const user_to_client = raw_user => {
    return {
        username: raw_user.username,
        // This `uuid` is not an internal-only ID.
        uuid: raw_user.uuid,
    };
};
