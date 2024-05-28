const Component = use('util.Component');

export default def(class Button extends Component {
    static ID = 'ui.component.Button';

    static PROPERTIES = {
        label: { value: 'Test Label' },
        on_click: { value: null },
        enabled: { value: true },
        style: { value: 'primary' }
    }

    static RENDER_MODE = Component.NO_SHADOW;

    static CSS = /*css*/`
        button {
            margin: 0;
            color: hsl(220, 25%, 31%);
        }
        .link-button {
            background: none;
            border: none;
            color: #3b4863;
            text-decoration: none;
            cursor: pointer;
            text-align: center;
            display: block;
            width: 100%;
        }
        .link-button:hover {
            text-decoration: underline;
        }
    `;

    create_template ({ template }) {
        if ( this.get('style') === 'link' ) {
            $(template).html(/*html*/`
                <button type="submit" class="link-button" style="margin-top:10px;" disabled>${
                    html_encode(this.get('label'))
                }</button>
            `);
            return;
        }
        // TODO: Replace hack for 'small' with a better way to configure button classes.
        $(template).html(/*html*/`
            <button type="submit" class="button ${this.get('style') !== 'small' ? 'button-block' : ''} button-${this.get('style')}" style="margin-top:10px;" disabled>${
                html_encode(this.get('label'))
            }</button>
        `);

    }

    on_ready ({ listen }) {
        if ( this.get('on_click') ) {
            const $button = $(this.dom_).find('button');
            $button.on('click', async () => {
                $button.html(`<svg style="width:20px; margin-top: 5px;" xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24"><title>circle anim</title><g fill="#fff" class="nc-icon-wrapper"><g class="nc-loop-circle-24-icon-f"><path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#eee" opacity=".4"></path><path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path></g><style>.nc-loop-circle-24-icon-f{--animation-duration:0.5s;transform-origin:12px 12px;animation:nc-loop-circle-anim var(--animation-duration) infinite linear}@keyframes nc-loop-circle-anim{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></g></svg>`);
                const on_click = this.get('on_click');
                await on_click();
                $button.html(this.get('label'));
            });
        }

        listen('enabled', enabled => {
            $(this.dom_).find('button').prop('disabled', ! enabled);
        });
    }
});
