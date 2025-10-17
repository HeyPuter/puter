/**
 * Copyright (C) 2024-present Puter Technologies Inc.
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

import UIWindow from './UIWindow.js'
import UIWindowMyWebsites from './UIWindowMyWebsites.js'

async function UIWindowPublishWebsite(target_dir_uid, target_dir_name, target_dir_path){
    let h = '';
    h += `<div class="window-publishWebsite-content" style="padding: 20px; border-bottom: 1px solid #ced7e1;">`;
        // success
        h += `<div class="window-publishWebsite-success">`;
            h += `<img src="${html_encode(window.icons['c-check.svg'])}" style="width:80px; height:80px; display: block; margin:10px auto;">`;
            h += `<p style="text-align:center;">${i18n('dir_published_as_website', `<strong>${html_encode(target_dir_name)}</strong>`, false)}<p>`;
            h += `<p style="text-align:center;"><a class="publishWebsite-published-link" target="_blank"></a><img class="publishWebsite-published-link-icon" src="${html_encode(window.icons['launch.svg'])}"></p>`;
            h += `<button class="button button-normal button-block button-primary publish-window-ok-btn" style="margin-top:20px;">${i18n('ok')}</button>`;
        h+= `</div>`;
        // form
        h += `<form class="window-publishWebsite-form">`;
            // error msg
            h += `<div class="publish-website-error-msg"></div>`;
            
            // Publishing options
            h += `<div class="publishing-options" style="margin-bottom: 20px;">`;
                h += `<label style="margin-bottom: 15px; display: block; font-weight: 600;">${i18n('choose_publishing_option')}</label>`;
                
                // Check if user has active subscription for custom domains
                const hasActiveSubscription = window.user && window.user.subscription && window.user.subscription.active;
                
                // Puter subdomain option
                h += `<div class="option-container" style="margin-bottom: 15px;">`;
                    h += `<label class="option-label" style="display: flex; align-items: center; cursor: pointer; padding: 10px; border: 2px solid #e1e8ed; border-radius: 8px;">`;
                        h += `<input type="radio" name="publishing-type" value="puter" checked style="margin-right: 10px;">`;
                        h += `<div>`;
                            h += `<div style="font-weight: 500; margin-bottom: 5px;">Free Puter Subdomain</div>`;
                            h += `<div style="font-size: 12px; color: #666; line-height: 1.4;">Get a free subdomain on puter.site - quick and easy setup</div>`;
                        h += `</div>`;
                    h += `</label>`;
                h += `</div>`;
                
                // Custom domain option  
                h += `<div class="option-container">`;
                    const customDomainDisabled = !hasActiveSubscription;
                    const customDomainStyle = customDomainDisabled ? 
                        'display: flex; align-items: center; cursor: not-allowed; padding: 10px; border: 2px solid #e1e8ed; border-radius: 8px; opacity: 0.5; background-color: #f8f9fa;' :
                        'display: flex; align-items: center; cursor: pointer; padding: 10px; border: 2px solid #e1e8ed; border-radius: 8px;';
                        
                    h += `<label class="option-label custom-domain-label" style="${customDomainStyle}">`;
                        h += `<input type="radio" name="publishing-type" value="custom" ${customDomainDisabled ? 'disabled' : ''} style="margin-right: 10px;">`;
                        h += `<div>`;
                            h += `<div style="font-weight: 500; margin-bottom: 5px;">Custom Domain ${customDomainDisabled ? '(Premium)' : ''}</div>`;
                            if (customDomainDisabled) {
                                h += `<div style="font-size: 12px; color: #999; line-height: 1.4;">Upgrade to Premium to use your own domain name</div>`;
                            } else {
                                h += `<div style="font-size: 12px; color: #666; line-height: 1.4;">Use your own domain name with professional setup</div>`;
                            }
                        h += `</div>`;
                    h += `</label>`;
                h += `</div>`;
            h += `</div>`;
            
            // Puter subdomain input (shown by default)
            h += `<div class="puter-subdomain-section" style="overflow: hidden; margin-bottom: 20px;">`;
                h += `<label style="margin-bottom: 10px; display: block;">${i18n('pick_name_for_website')}</label>`;
                h += `<div style="font-family: monospace; display: flex; align-items: center; background: #f8f9fa; padding: 8px; border-radius: 6px; border: 1px solid #dee2e6;">`;
                    h += `<span style="color: #666;">${html_encode(window.extractProtocol(window.url))}://</span>`;
                    h += `<input class="publish-website-subdomain" style="border: none; background: #ffffff; outline: none; padding: 7px !important; " type="text" autocomplete="subdomain" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
                    h += `<span style="color: #666;">.${html_encode(window.hosting_domain)}</span>`;
                h += `</div>`;
            h += `</div>`;
            
            // Custom domain input (hidden by default)
            h += `<div class="custom-domain-section" style="display: none; margin-bottom: 20px;">`;
                h += `<label style="margin-bottom: 10px; display: block;">Enter your custom domain</label>`;
                h += `<input class="publish-website-custom-domain" style="width: 100%; padding: 10px; border: 1px solid #dee2e6; border-radius: 6px; font-family: monospace;" type="text" placeholder="example.com" spellcheck="false" autocorrect="off" autocapitalize="off" data-gramm_editor="false"/>`;
            h += `</div>`;
            
            // uid
            h += `<input class="publishWebsiteTargetDirUID" type="hidden" value="${html_encode(target_dir_uid)}"/>`;
            // Publish
            h += `<button class="publish-btn button button-action button-block button-normal">${i18n('publish')}</button>`
        h += `</form>`;
    h += `</div>`;

    const el_window = await UIWindow({
        title: i18n('window_title_publish_website'),
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        width: 450,
        dominant: true,
        onAppend: function(this_window){
            $(this_window).find(`.publish-website-subdomain`).val(window.generate_identifier());
            $(this_window).find(`.publish-website-subdomain`).get(0).focus({preventScroll:true});
            
            // Handle radio button changes
            $(this_window).find('input[name="publishing-type"]:not(:disabled)').on('change', function(){
                const selectedValue = $(this).val();
                const puterSection = $(this_window).find('.puter-subdomain-section');
                const customSection = $(this_window).find('.custom-domain-section');
                const puterLabel = $(this_window).find('input[value="puter"]').closest('.option-label');
                const customLabel = $(this_window).find('input[value="custom"]').closest('.option-label');
                
                // Update visual selection (only if not disabled)
                puterLabel.css('border-color', selectedValue === 'puter' ? '#007bff' : '#e1e8ed');
                if (!$(this_window).find('input[value="custom"]').is(':disabled')) {
                    customLabel.css('border-color', selectedValue === 'custom' ? '#007bff' : '#e1e8ed');
                }
                
                if(selectedValue === 'puter'){
                    puterSection.show();
                    customSection.hide();
                    $(this_window).find(`.publish-website-subdomain`).focus();
                } else if (selectedValue === 'custom') {
                    puterSection.hide();
                    customSection.show();
                    $(this_window).find(`.publish-website-custom-domain`).focus();
                }
            });
            
            // Add click handler for disabled custom domain option to show upgrade message
            $(this_window).find('.custom-domain-label').on('click', function(e){
                const radioButton = $(this).find('input[type="radio"]');
                if (radioButton.is(':disabled')) {
                    e.preventDefault();
                    // Could show upgrade modal here in the future
                    if(puter.defaultGUIOrigin === 'https://puter.com'){
                        $(this_window).find('.publish-website-error-msg').html(
                            'Custom domains require a Premium subscription. <a href="/settings/subscriptions" target="_blank">Upgrade now</a> to use your own domain name.'
                        );
                    }else{
                        $(this_window).find('.publish-website-error-msg').html(
                            'Custom domains are not available on this instance of Puter. Yet!'
                        );
                    }
                    $(this_window).find('.publish-website-error-msg').fadeIn();
                    setTimeout(() => {
                        $(this_window).find('.publish-website-error-msg').fadeOut();
                    }, 5000);
                }
            });
            
            // Style the selected option initially
            $(this_window).find('input[value="puter"]').closest('.option-label').css('border-color', '#007bff');
        },
        window_class: 'window-publishWebsite',
        window_css:{
            height: 'initial'
        },
        body_css: {
            width: 'initial',
            height: '100%',
            'background-color': 'rgb(245 247 249)',
            'backdrop-filter': 'blur(3px)',
        }    
    })

    // Function to load Entri SDK
    async function loadEntriSDK() {
        if (!window.entri) {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.type = "text/javascript";
                script.src = "https://cdn.goentri.com/entri.js";
                script.addEventListener("load", () => {
                    resolve(window.entri);
                });
                script.addEventListener("error", () => {
                    reject(new Error("Failed to load the Entri SDK."));
                });
                document.body.appendChild(script);
            });
        }
    }

    $(el_window).find('.publish-btn').on('click', async function(e){
        e.preventDefault();
        
        // Get the selected publishing type
        const publishingType = $(el_window).find('input[name="publishing-type"]:checked').val();
        
        // disable 'Publish' button
        $(el_window).find('.publish-btn').prop('disabled', true);

        try {
            if (publishingType === 'puter') {
                // Handle Puter subdomain publishing
                let subdomain = $(el_window).find('.publish-website-subdomain').val();
                
                if (!subdomain.trim()) {
                    throw new Error('Please enter a subdomain name');
                }

                const res = await puter.hosting.create(subdomain, target_dir_path);
                let url = 'https://' + subdomain + '.' + window.hosting_domain + '/';
                
                // Show success
                $(el_window).find('.window-publishWebsite-form').hide(100, function(){
                    $(el_window).find('.publishWebsite-published-link').attr('href', url);
                    $(el_window).find('.publishWebsite-published-link').text(url);
                    $(el_window).find('.window-publishWebsite-success').show(100)
                    $(`.item[data-uid="${target_dir_uid}"] .item-has-website-badge`).show();
                });

                // find all items whose path starts with target_dir_path
                $(`.item[data-path^="${target_dir_path}/"]`).each(function(){
                    // show the link badge
                    $(this).find('.item-has-website-url-badge').show();
                    // update item's website_url attribute
                    $(this).attr('data-website_url', url + $(this).attr('data-path').substring(target_dir_path.length));
                })

                window.update_sites_cache();
                
            } else if (publishingType === 'custom') {
                // Handle custom domain publishing with Entri
                let customDomain = $(el_window).find('.publish-website-custom-domain').val();
                
                if (!customDomain.trim()) {
                    throw new Error('Please enter your custom domain');
                }
                
                // Step 1: First create a Puter subdomain to host the content
                let subdomain = $(el_window).find('.publish-website-subdomain').val();
                if (!subdomain.trim()) {
                    // Generate a subdomain if not provided
                    subdomain = window.generate_identifier();
                }
                
                const hostingRes = await puter.hosting.create(subdomain, target_dir_path);
                const puterSiteUrl = 'https://' + subdomain + '.' + window.hosting_domain;
                
                // Step 2: Load Entri SDK
                await loadEntriSDK();
                
                // Step 3: Get Entri config from the backend using the Puter subdomain as userHostedSite
                const entriConfig = await puter.drivers.call("entri", "entri-service", "getConfig", {
                    domain: customDomain,
                    userHostedSite: subdomain + '.' + window.hosting_domain
                });
                
                // Step 4: Show Entri interface for custom domain setup
                await entri.showEntri(entriConfig.result);
                
                // Step 5: Show success message with custom domain
                let customUrl = 'https://' + customDomain + '/';

                // Update items to show both the Puter subdomain and custom domain
                $(`.item[data-path^="${target_dir_path}/"]`).each(function(){
                    // show the link badge
                    $(this).find('.item-has-website-url-badge').show();
                    // update item's website_url attribute to use custom domain
                    $(this).attr('data-website_url', customUrl + $(this).attr('data-path').substring(target_dir_path.length));
                    // Also store the puter subdomain URL as backup
                    $(this).attr('data-puter_website_url', puterSiteUrl + $(this).attr('data-path').substring(target_dir_path.length));
                })

                window.update_sites_cache();

                $(el_window).close();
            }
            
        } catch (err) {
            const errorMessage = err.message || (err.error && err.error.message) || 'An error occurred while publishing';
            $(el_window).find('.publish-website-error-msg').html(
                errorMessage + (
                    err.error && err.error.code === 'subdomain_limit_reached' ? 
                        ' <span class="manage-your-websites-link">' + i18n('manage_your_subdomains') + '</span>' : ''
                )
            );
            $(el_window).find('.publish-website-error-msg').fadeIn();
            // re-enable 'Publish' button
            $(el_window).find('.publish-btn').prop('disabled', false);
        }
    })

    $(el_window).find('.publish-window-ok-btn').on('click', function(){
        $(el_window).close();
    })
}

$(document).on('click', '.manage-your-websites-link', async function(e){
    UIWindowMyWebsites();
})


export default UIWindowPublishWebsite