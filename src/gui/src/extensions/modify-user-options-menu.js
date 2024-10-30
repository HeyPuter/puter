$(window).on('ctxmenu-will-open', (event) => {
    if(event.detail.options?.id === 'user-options-menu'){
        // Define array of new menu items
        const newMenuItems = [
            // Separator
            '-',
            // 'Developer', opens developer site in new tab
            {
                id: 'go_to_developer_site',
                html: 'Developer<svg style="width: 11px; height: 11px; margin-left:2px;" height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg"><path d="m26 28h-20a2.0027 2.0027 0 0 1 -2-2v-20a2.0027 2.0027 0 0 1 2-2h10v2h-10v20h20v-10h2v10a2.0027 2.0027 0 0 1 -2 2z"/><path d="m20 2v2h6.586l-8.586 8.586 1.414 1.414 8.586-8.586v6.586h2v-10z"/><path d="m0 0h32v32h-32z" fill="none"/></svg>',
                html_active: 'Developer<svg style="width: 11px; height: 11px; margin-left:2px;" height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg"> <path d="m26 28h-20a2.0027 2.0027 0 0 1 -2-2v-20a2.0027 2.0027 0 0 1 2-2h10v2h-10v20h20v-10h2v10a2.0027 2.0027 0 0 1 -2 2z" style="fill: rgb(255, 255, 255);"/> <path d="m20 2v2h6.586l-8.586 8.586 1.414 1.414 8.586-8.586v6.586h2v-10z" style="fill: rgb(255, 255, 255);"/> <path d="m0 0h32v32h-32z" fill="none"/> </svg>',
                action: function(){
                    window.open('https://developer.puter.com', '_blank');
                }
            },
        ];

        // Find the position of 'contact_us'
        const items = event.detail.options.items;
        const insertBeforeIndex = items.findIndex(item => item.id === 'contact_us');
        
        // 'contact_us' not found, append new items at the end
        if (insertBeforeIndex === -1) {
            event.detail.options.items = [...items, ...newMenuItems];
            return;
        }

        // 'contact_us' found, insert new items before it
        const firstHalf = items.slice(0, insertBeforeIndex);
        const secondHalf = items.slice(insertBeforeIndex);
        event.detail.options.items = [...firstHalf, ...newMenuItems, ...secondHalf];
    }
});