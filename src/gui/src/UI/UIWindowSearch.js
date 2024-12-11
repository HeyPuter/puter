/**
 * Gestion du double-clic et du clic droit
 * - Double-clic ouvre les fichiers et les dossiers.
 * - Clic droit affiche un menu contextuel avec "Open Dir" pour les dossiers et "Open File" pour les fichiers.
 * - Le menu contextuel disparaît et le cache est effacé après l'exécution de l'action.
 */

import UIWindow from './UIWindow.js';
import path from "../lib/path.js";
import UIAlert from './UIAlert.js';
import launch_app from '../helpers/launch_app.js';
import item_icon from '../helpers/item_icon.js';
import UIContextMenu from './UIContextMenu.js';

async function UIWindowSearch(options) {
    let h = '';

    h += `<div class="search-input-wrapper">`;
    h += `<input type="text" class="search-input" placeholder="Search" style="background-image:url('${window.icons['magnifier-outline.svg']}');">`;
    h += `</div>`;
    h += `<div class="search-results" style="overflow-y: auto; max-height: 300px;"></div>`;

    const el_window = await UIWindow({
        icon: null,
        single_instance: true,
        app: 'search',
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: false,
        draggable_body: true,
        allow_context_menu: false,
        is_draggable: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: true,
        allow_user_select: true,
        window_class: 'window-search',
        width: 500,
        dominant: true,
        window_css: {
            height: 'initial',
            padding: '0',
        },
        body_css: {
            width: 'initial',
            'max-height': 'calc(100vh - 200px)',
            'background-color': 'rgb(241 246 251)',
            'backdrop-filter': 'blur(3px)',
            'padding': '0',
            'height': 'initial',
            'overflow': 'hidden',
            'min-height': '65px',
            'padding-bottom': '10px',
        },
    });

    $(el_window).find('.search-input').focus();

    // Fonction debounce pour limiter les appels API
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }

    const performSearch = debounce(async function (searchInput, resultsContainer) {
        if (searchInput.val() === '') {
            resultsContainer.html('');
            resultsContainer.hide();
            return;
        }

        try {
            let results = await fetch(window.api_origin + '/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({ text: searchInput.val() }),
            });

            results = await results.json();

            if (results.length === 0) {
                resultsContainer.hide();
                return;
            }

            resultsContainer.show();
            let h = '';

            for (let result of results) {
                h += `<div 
                        class="search-result"
                        data-path="${html_encode(result.path)}" 
                        data-uid="${html_encode(result.uid)}"
                        data-is_dir="${html_encode(result.is_dir)}"
                    >`;
                h += `<img src="${(await item_icon(result)).image}" style="width: 20px; height: 20px; margin-right: 6px;">`;
                h += html_encode(result.name);
                h += `</div>`;
            }

            resultsContainer.html(h);
        } catch (error) {
            resultsContainer.html('<div class="search-error">Search failed. Please try again.</div>');
            console.error('Search error:', error);
        }
    }, 300);

    $(el_window).find('.search-input').on('input', function () {
        const searchInput = $(this);
        const resultsContainer = $(el_window).find('.search-results');
        performSearch(searchInput, resultsContainer);
    });

   // Handle clicks on search results

$(document).off('click', '.search-result').on('click', '.search-result', async function(e) {
    const fspath = $(this).data('path');
    const fsuid = $(this).data('uid');
    const is_dir = $(this).attr('data-is_dir') === 'true' || $(this).data('is_dir') === '1';

    if (is_dir) {
        try {
            UIWindow({
                path: fspath,
                title: path.basename(fspath),
                icon: await item_icon({ is_dir: true, path: fspath }),
                uid: fsuid,
                is_dir: true,
                app: 'explorer',
            });

            // Close the search window
            $(this).closest('.window').close();
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    } else {
        openFile($(this));
    }
});

  // Handle right-click with context menu
$(document).off('contextmenu', '.search-result').on('contextmenu', '.search-result', async function (e) {
    e.preventDefault(); // Prevents the default context menu

    const item = $(this);
    const isDir = item.attr('data-is_dir') === 'true' || item.data('is_dir') === '1';
    $('.context-menu').remove();
    // Create the context menu with specific options
    UIContextMenu({
        parent_element: $(this),
        event: e,
        items: isDir
            ? [
                  {
                      html: "Open Containing Folder",
                      onClick: async function () {
                          const dirPath = item.data('path');
                          const dirUid = item.data('uid');

                          // Opens the directory
                          try {
                              UIWindow({
                                  path: dirPath,
                                  title: path.basename(dirPath),
                                  icon: await item_icon({ is_dir: true, path: dirPath }),
                                  uid: dirUid,
                                  is_dir: true,
                                  app: 'explorer',
                              });
                          } catch (error) {
                              console.error('Error opening directory:', error);
                          }
                          clearCache();
                      },
                  },
              ]
            : [
                  {
                      html: "Open File",
                      onClick: async function () {
                          openFile(item); // Calls the function to open the file
                         
                          clearCache();
                      },
                  },
              ],
    });
});

// Function to open a file
async function openFile(item) {
    const filePath = item.data('path');
    const fileUid = item.data('uid');
    let open_item_meta;

    try {
        open_item_meta = await $.ajax({
            url: window.api_origin + "/open_item",
            type: 'POST',
            contentType: "application/json",
            data: JSON.stringify({
                uid: fileUid ?? undefined,
                path: filePath ?? undefined,
            }),
            headers: {
                "Authorization": "Bearer " + window.auth_token,
            },
        });

        const suggested_apps = open_item_meta?.suggested_apps ?? [];
        if (suggested_apps.length > 0) {
            launch_app({
                name: suggested_apps[0].name,
                token: open_item_meta.token,
                file_path: filePath,
                app_obj: suggested_apps[0],
                window_title: path.basename(filePath),
                file_uid: fileUid,
            });
        } else {
            console.log("No suitable app to open the file.");
        }
    } catch (error) {
        console.error('Error opening file:', error);
    } 
}

}

export default UIWindowSearch;
