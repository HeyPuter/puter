const Component = use('util.Component');

export default def(class Spinner extends Component {
    static ID = 'ui.component.Spinner';

    static PROPERTIES = {
        size: {
            value: 24,
        },
    }
    // static RENDER_MODE = Component.NO_SHADOW;

    create_template ({ template }) {
        const size = '' + Number(this.get('size'));

        template.innerHTML = /*html*/`
            <div>
                <svg style="display:block; margin: 0 auto; " xmlns="http://www.w3.org/2000/svg" height="${size}" width="${size}" viewBox="0 0 24 24">
                    <title>circle anim</title>
                    <g fill="#212121" class="nc-icon-wrapper">
                        <g class="nc-loop-circle-24-icon-f">
                            <path d="M12 24a12 12 0 1 1 12-12 12.013 12.013 0 0 1-12 12zm0-22a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2z" fill="#212121" opacity=".4"></path>
                            <path d="M24 12h-2A10.011 10.011 0 0 0 12 2V0a12.013 12.013 0 0 1 12 12z" data-color="color-2"></path>
                        </g>
                        <style>
                            .nc-loop-circle-24-icon-f{
                                --animation-duration:0.5s;
                                transform-origin:12px 12px;
                                animation:nc-loop-circle-anim var(--animation-duration) infinite linear
                            }
                            @keyframes nc-loop-circle-anim{
                                0%{
                                    transform:rotate(0)
                                }
                                100%{
                                    transform:rotate(360deg)
                                }
                            }
                        </style>
                    </g>
                </svg>
            </div>
        `;
    }
});
