/**
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

function UINotification(options){
    window.global_element_id++;
    options.text = options.text ?? '';

    let h = '';
    h += `<div id="ui-notification__${window.global_element_id}" data-el-id="${window.global_element_id}" class="notification antialiased animate__animated animate__fadeInRight animate__slow">`;
        h += `<img class="notification-close disable-user-select" src="${html_encode(window.icons['close.svg'])}">`;
        h += `<div class="notification-icon">`;
            h += `<img src="${html_encode(options.icon ?? window.icons['bell.svg'])}">`;
        h += `</div>`;
        h += `<div class="notification-content">`;
            h += `<div class="notification-title">${html_encode(options.title)}</div>`;
            h += `<div class="notification-text">${html_encode(options.text)}</div>`;
        h += `</div>`;
    h += `</div>`;

    $('.notification-container').prepend(h);


    const el_notification = document.getElementById(`ui-notification__${window.global_element_id}`);

    // now wrap it in a div
    $(el_notification).wrap('<div class="notification-wrapper"></div>');

    $(el_notification).show(0, function(e){
        // options.onAppend()
        if(options.onAppend && typeof options.onAppend === 'function'){
            options.onAppend(el_notification);
        }
    })

    // Notification Clicked
    $(el_notification).on('click', function(e){
        // close button clicked
        if($(e.target).hasClass('notification-close')){
            return;
        }

        // click event
        if(options.click && typeof options.click === 'function'){
            options.click(options.value);
        }

        // close notification
        close_notification(el_notification);
    })

    // Close Button Clicked
    $(el_notification).find('.notification-close').on('click', function(e, data){
        let closingMultiple = false;
        if(data?.closingAll)
            closingMultiple = true;

        close_notification(el_notification, closingMultiple);
        e.stopPropagation();
        e.preventDefault();
        return false;    
    });

    const close_notification = function(el_notification, closingMultiple = false){
        // hide notification wrapper by animating height and opacity
        // only if closing one notification and there are multiple notifications
        // otherwise the animation is not needed
        if(!closingMultiple && $('.notification').length > 1){
            $(el_notification).closest('.notification-wrapper').animate({
                height: 0,
                opacity: 0
            }, 300);
        }

        // hide notification by fading out to the right
        $(el_notification).addClass('animate__fadeOutRight');
    
        // close callback
        if(options.close && typeof options.close === 'function'){
            options.close(options.value);
        }

        // remove notification and wrapper after animation
        setTimeout(function(){
            $(el_notification).closest('.notification-wrapper').remove();
            $(el_notification).remove();
            // count notifications
            let count = $('.notification-container').find('.notification-wrapper').length;
            if(count <= 1){
                $('.notification-container').removeClass('has-multiple');
            }else{
                $('.notification-container').addClass('has-multiple');
            }
        }, 500);
    }
    // Show Notification
    $(el_notification).delay(100).show(0);

    // count notifications
    let count = $('.notification-container').find('.notification-wrapper').length;
    if(count <= 1){
        $('.notification-container').removeClass('has-multiple');
    }else{
        $('.notification-container').addClass('has-multiple');
    }

    return el_notification;
}

$(document).on('click', '.notifications-close-all', function(e){
    // close all notifications
    $('.notification-container').find('.notification-close').trigger('click', {closingAll: true});
    // hide 'Close all' button
    $('.notifications-close-all').animate({
        opacity: 0
    }, 300);
    // remove the 'has-multiple' class
    $('.notification-container').removeClass('has-multiple');
    // prevent default
    e.stopPropagation();
    e.preventDefault();
    return false;
})

export default UINotification;