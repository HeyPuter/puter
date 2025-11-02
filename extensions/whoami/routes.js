// static imports
import TimeAgo from 'javascript-time-ago';
import localeEn from 'javascript-time-ago/locale/en';

// runtime imports
const { UserActorType, AppUnderUserActorType } = extension.import('core');
const {
    id2uuid,
    get_descendants,
    suggest_app_for_fsentry,
    is_shared_with_anyone,
    get_app,
    get_taskbar_items,
} = extension.import('core').util.helpers;

const timeago = (() => {
    TimeAgo.addDefaultLocale(localeEn);
    return new TimeAgo('en-US');
})();

const whoami_common = ({ is_user, user }) => {
    const details = {};

    // User's immutable default (often called "system") directories'
    // alternative (to path) identifiers are sent to the user's client
    // (but not to apps; they don't need this information)
    if ( is_user ) {
        const directories = details.directories = {};
        const name_to_path = {
            'desktop_uuid': `/${user.username}/Desktop`,
            'appdata_uuid': `/${user.username}/AppData`,
            'documents_uuid': `/${user.username}/Documents`,
            'pictures_uuid': `/${user.username}/Pictures`,
            'videos_uuid': `/${user.username}/Videos`,
            'trash_uuid': `/${user.username}/Trash`,
        };
        for ( const k in name_to_path ) {
            directories[name_to_path[k]] = user[k];
        }
    }

    if ( user.last_activity_ts ) {

        // Create a Date object and get the epoch timestamp
        let epoch;
        try {
            epoch = new Date(user.last_activity_ts).getTime();
            // round to 1 decimal place
            epoch = Math.round(epoch / 1000);
        } catch (e) {
            console.error('Error parsing last_activity_ts', e);
        }

        // add last_activity_ts
        details.last_activity_ts = epoch;
    }

    return details;
};

extension.get('/whoami', { subdomain: 'api' }, async (req, res, next) => {
    const actor = req.actor;
    if ( ! actor ) {
        throw Error('actor not found in context');
    }

    const is_user = actor.type instanceof UserActorType;

    if ( req.query.icon_size ) {
        const ALLOWED_SIZES = ['16', '32', '64', '128', '256', '512'];

        if ( ! ALLOWED_SIZES.includes(req.query.icon_size) ) {
            res.status(400).send({ error: 'Invalid icon_size' });
        }
    }

    const details = {
        username: req.user.username,
        uuid: req.user.uuid,
        email: req.user.email,
        unconfirmed_email: req.user.email,
        email_confirmed: req.user.email_confirmed
            || req.user.username === 'admin',
        requires_email_confirmation: req.user.requires_email_confirmation,
        desktop_bg_url: req.user.desktop_bg_url,
        desktop_bg_color: req.user.desktop_bg_color,
        desktop_bg_fit: req.user.desktop_bg_fit,
        is_temp: (req.user.password === null && req.user.email === null),
        taskbar_items: await get_taskbar_items(req.user, {
            ...(req.query.icon_size
                ? { icon_size: req.query.icon_size }
                : { no_icons: true }),
        }),
        referral_code: req.user.referral_code,
        otp: !! req.user.otp_enabled,
        human_readable_age: timeago.format(new Date(req.user.timestamp)),
        ...(req.new_token ? { token: req.token } : {}),
    };

    // TODO: redundant? GetUserService already puts these values on 'user'
    // Get whoami values from other services
    const svc_whoami = req.services.get('whoami');
    const provider_details = await svc_whoami.get_details({
        user: req.user,
        actor: actor,
    });
    Object.assign(details, provider_details);

    if ( ! is_user ) {
        // When apps call /whoami they should not see these attributes
        // delete details.username;
        // delete details.uuid;
        delete details.email;
        delete details.unconfirmed_email;
        delete details.desktop_bg_url;
        delete details.desktop_bg_color;
        delete details.desktop_bg_fit;
        delete details.taskbar_items;
        delete details.token;
        delete details.human_readable_age;
    }

    if ( actor.type instanceof AppUnderUserActorType ) {
        details.app_name = actor.type.app.name;

        // IDEA: maybe we do this in the future
        // details.app = {
        //     name: actor.type.app.name,
        // };
    }

    Object.assign(details, whoami_common({ is_user, user: req.user }));

    res.send(details);
});

extension.post('/whoami', { subdomain: 'api' }, async (req, res) => {
    const actor = req.actor;
    if ( ! actor ) {
        throw Error('actor not found in context');
    }

    const is_user = actor.type instanceof UserActorType;
    if ( ! is_user ) {
        throw Error('actor is not a user');
    }

    let desktop_items = [];

    // check if user asked for desktop items
    if(req.query.return_desktop_items === 1 || req.query.return_desktop_items === '1' || req.query.return_desktop_items === 'true'){
        // by cached desktop id
        if(req.user.desktop_id){
            // TODO: Check if used anywhere, maybe remove
            // eslint-disable-next-line no-undef
            desktop_items = await db.read(
                `SELECT * FROM fsentries
                WHERE user_id = ? AND parent_uid = ?`,
                [req.user.id, await id2uuid(req.user.desktop_id)]
            )
        }
        // by desktop path
        else{
            desktop_items = await get_descendants(req.user.username +'/Desktop', req.user, 1, true);
        }

        // clean up desktop items and add some extra information
        if(desktop_items.length > 0){
            if(desktop_items.length > 0){
                for (let i = 0; i < desktop_items.length; i++) {
                    if(desktop_items[i].id !== null){
                        // suggested_apps for files
                        if(!desktop_items[i].is_dir){
                            desktop_items[i].suggested_apps = await suggest_app_for_fsentry(desktop_items[i], {user: req.user});
                        }
                        // is_shared
                        desktop_items[i].is_shared   = await is_shared_with_anyone(desktop_items[i].id);

                        // associated_app
                        if(desktop_items[i].associated_app_id){
                            const app = await get_app({id: desktop_items[i].associated_app_id})

                            // remove some privileged information
                            delete app.id;
                            delete app.approved_for_listing;
                            delete app.approved_for_opening_items;
                            delete app.godmode;
                            delete app.owner_user_id;
                            // add to array
                            desktop_items[i].associated_app = app;

                        }else{
                            desktop_items[i].associated_app = {};
                        }

                        // remove associated_app_id since it's sensitive info
                        // delete desktop_items[i].associated_app_id;
                    }
                    // id is sesitive info
                    delete desktop_items[i].id;
                    delete desktop_items[i].user_id;
                    delete desktop_items[i].bucket;
                    desktop_items[i].path = _path.join('/', req.user.username, desktop_items[i].name)
                }
            }
        }
    }

    // send user object
    res.send(Object.assign({
        username: req.user.username,
        uuid: req.user.uuid,
        email: req.user.email,
        email_confirmed: req.user.email_confirmed
            || req.user.username === 'admin',
        requires_email_confirmation: req.user.requires_email_confirmation,
        desktop_bg_url: req.user.desktop_bg_url,
        desktop_bg_color: req.user.desktop_bg_color,
        desktop_bg_fit: req.user.desktop_bg_fit,
        is_temp: (req.user.password === null && req.user.email === null),
        taskbar_items: await get_taskbar_items(req.user),
        desktop_items: desktop_items,
        referral_code: req.user.referral_code,
    }, whoami_common({ is_user, user: req.user })));
});
