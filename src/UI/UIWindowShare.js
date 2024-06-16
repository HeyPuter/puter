import UIWindow from './UIWindow.js'

async function UIWindowShare(items){
    return new Promise(async (resolve) => {
        let h = '';
        h += `<div style="padding: 30px 40px 20px; border-bottom: 1px solid #ced7e1;">`;
            // success
            h += `<div class="window-give-item-access-success">`;
                h += `<span class="hide-sharing-success-alert">✕</span>`
                h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:50px; height:50px; display: block; margin:10px auto;">`;
                h += `<p style="text-align:center; margin-bottom:10px;">Shared with <strong class="access-recipient-print"></strong></p>`;
            h+= `</div>`;

            // form
            h += `<form class="window-give-item-access-form">`;
                // error msg
                h += `<div class="error"></div>`;
                // username/email
                h += `<div style="overflow: hidden;">`;
                    h += `<label style="margin-bottom: 10px;">The user you want to share ${ items.length > 1 ? `these items` : `this item`} with:</label>`;
                    h += `<div style="display: flex;">`;
                        //username/email
                        h += `<input placeholder="username" class="access-recipient" style="border-right: none; margin-bottom: 10px; border-top-right-radius: 0; border-bottom-right-radius: 0;" type="text" autocomplete="recipient_email_username" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                        // Share
                        h += `<button class="give-access-btn button button-primary button-normal" style="border-top-left-radius: 0; border-bottom-left-radius: 0;">Share</button>`
                    h += `</div>`;                
                h += `</div>`;
            h += `</form>`;

            //recipients
            // h += `<h2 style="font-size: 17px;
            // margin-bottom: 0px;
            // font-weight: 400;
            // color: #303d49;
            // text-shadow: 1px 1px white;">People with access</h2>`;
            // h += `<div class="share-recipients">`;
            // h += `</div>`;
        h += `</div>`;

        const el_window = await UIWindow({
            title: 'Share With…',
            icon: null,
            uid: null,
            is_dir: false,
            body_content: h,
            draggable_body: false,
            has_head: true,
            selectable_body: false,
            draggable_body: false,
            allow_context_menu: false,
            is_resizable: false,
            is_droppable: false,
            init_center: true,
            allow_native_ctxmenu: true,
            allow_user_select: true,
            onAppend: function(this_window){
                $(this_window).find(`.access-recipient`).get(0).focus({preventScroll:true});
            },
            window_class: 'window-give-access',
            width: 550,
            window_css: {
                height: 'initial',
            },
            body_css: {
                width: 'initial',
                height: '100%',
                'background-color': 'rgb(245 247 249)',
                'backdrop-filter': 'blur(3px)',
            }
        })

        // /stat
        let perms = [];
        for(let i=0; i<items.length; i++){
            $.ajax({
                url: api_origin + "/stat",
                type: 'POST',
                data: JSON.stringify({ 
                    uid: items[i].uid,
                    return_subdomains: false,
                    return_permissions: true,
                }),
                async: false,
                contentType: "application/json",
                headers: {
                    "Authorization": "Bearer "+auth_token
                },
                statusCode: {
                    401: function () {
                        logout();
                    },
                },        
                success: function (fsentry){
                    perms.push(fsentry);
                },
            })
        }
        // if(perms.length > 0){
        //     let printed_users = [];
        //     let perm_list = '';
        //     perms.forEach(fsentry => {
        //         //owner
        //         //check if this user has been printed here before, important for multiple items
        //         if(!printed_users.includes(fsentry.owner.username)){
        //             perm_list += `<div class="item-perm-recipient-card item-prop-perm-entry item-permission-owner" style="margin-bottom:5px; margin-top:5px; background-color: #f2f2f2;">`
        //                 if(fsentry.owner.username === window.user.username)
        //                     perm_list += `You (${fsentry.owner.email ?? fsentry.owner.username})`;
        //                 else
        //                     perm_list += fsentry.owner.email ?? fsentry.owner.username;
        //                 perm_list += `<div style="float:right;"><span class="permission-owner-badge">owner</span></div>`;
        //             perm_list += `</div>`;
        //             // add this user to the list of printed users
        //             printed_users.push(fsentry.owner.username);
        //         }

        //         // others with access
        //         if(fsentry.permissions.length > 0){
        //             fsentry.permissions.forEach(perm => {
        //                 //check if this user has been printed here before, important for multiple items
        //                 if(!printed_users.includes(perm.username)){
        //                     perm_list += `<div class="item-perm-recipient-card item-prop-perm-entry" data-perm-uid="${perm.uid}" style="margin-bottom:5px; margin-top:5px;">`
        //                         perm_list += `${perm.email ?? perm.username}`;
        //                         perm_list += `<div style="float:right;"><span class="remove-permission-link remove-permission-icon" data-perm-uid="${perm.uid}">✕</span></div>`;
        //                     perm_list += `</div>`;
        //                     // add this user to the list of printed users
        //                     printed_users.push(perm.username);
        //                 }
        //             });
        //         }
        //     });
        //     $(el_window).find('.share-recipients').append(`${perm_list}`);                  
        // }

        $(el_window).find('.give-access-btn').on('click', async function(e){
            e.preventDefault();
            e.stopPropagation();

            $(el_window).find('.error').hide();

            let recipient_email, recipient_username;
            let recipient_id = $(el_window).find('.access-recipient').val();

            // todo do some basic validation client-side
            if(recipient_id === null)
                return;

            if(is_email(recipient_id))
                recipient_email = recipient_id;
            else
                recipient_username = recipient_id;

            // disable 'Give Access' button
            $(el_window).find('.give-access-btn').prop('disabled', true);

            let cancelled_due_to_error = false;
            let share_result;

            $.ajax({
                url: puter.APIOrigin + "/share/item-by-username",
                type: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + puter.authToken
                },
                data: JSON.stringify({
                    path: items[0].path,
                    username: recipient_username
                }),
                success: function(response) {
                    // show success message
                    $(el_window).find('.access-recipient-print').html(recipient_id);
                    $(el_window).find('.window-give-item-access-success').show(100);
                },
                error: function(err) {
                    console.error(err);       
                    // at this point 'username_not_found' and 'shared_with_self' are the only 
                    // errors that need to stop the loop
                    if(err.responseJSON.code === "user_does_not_exist" || err.responseJSON.code === 'shared_with_self'){
                        $(el_window).find('.error').html(err.responseJSON.message);
                        $(el_window).find('.error').fadeIn();
                        cancelled_due_to_error = true;
                    }
                    // re-enable share button
                    $(el_window).find('.give-access-btn').prop('disabled', false);

                }
            });

            // finished
            if(!cancelled_due_to_error){
                $(el_window).find(`.access-recipient`).val('');
            }
            // re-enable share button
            $(el_window).find('.give-access-btn').prop('disabled', false);    

            return false;
        })

        $(el_window).find('.hide-sharing-success-alert').on('click', function(){
            $(el_window).find('.window-give-item-access-success').hide(200);
        })

    })
}

export default UIWindowShare