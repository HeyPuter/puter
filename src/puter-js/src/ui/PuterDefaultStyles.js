/**
 * PuterDefaultStyles - Shared CSS constants for the "default" theme
 * that matches puter.com's native GUI appearance exactly.
 *
 * These are plain CSS string constants composed into each component's
 * getDefaultStyles() method. They are NOT CSS custom properties —
 * values are hardcoded to match puter.com pixel-perfect.
 */

export const defaultFontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const defaultDialogCSS = `
    background-color: rgba(231, 238, 245, .95);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    font-family: ${defaultFontFamily};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
`;

export const defaultMessageCSS = `
    font-size: 15px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    color: #414650;
    text-shadow: 1px 1px #ffffff52;
    word-break: break-word;
`;

export const defaultButtonCSS = `
    /* Base button */
    .btn {
        color: #666666;
        font-size: 14px;
        text-align: center;
        line-height: 35px;
        height: 35px;
        padding: 0 30px;
        margin: 0;
        display: inline-block;
        appearance: none;
        cursor: pointer;
        box-sizing: border-box;
        border: 1px solid #b9b9b9;
        background: linear-gradient(#f6f6f6, #e1e1e1);
        box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
        border-radius: 4px;
        outline: none;
        font-family: ${defaultFontFamily};
    }
    .btn:active {
        background-color: #eeeeee;
        border-color: #cfcfcf;
        color: #a9a9a9;
        box-shadow: inset 0px 2px 3px rgb(0 0 0 / 36%), 0px 1px 0px white;
    }
    .btn:focus-visible {
        border-color: rgb(118 118 118);
    }

    /* Primary button */
    .btn-primary {
        border-color: #088ef0;
        background: linear-gradient(#34a5f8, #088ef0);
        color: white;
    }
    .btn-primary:active {
        background-color: #2798eb;
        border-color: #2798eb;
        color: #bedef5;
    }

    /* Danger button */
    .btn-danger {
        border-color: #f00808;
        background: linear-gradient(#ff4e4e, #ff4c4c);
        color: white;
    }

    /* Action/success button */
    .btn-success, .btn-action {
        border-color: #08bf4e;
        background: linear-gradient(#29d55d, #1ccd60);
        color: white;
    }

    /* Default button */
    .btn-default {
        color: #666666;
        border: 1px solid #b9b9b9;
        background: linear-gradient(#f6f6f6, #e1e1e1);
        box-shadow: inset 0px 1px 0px rgb(255 255 255 / 30%), 0 1px 2px rgb(0 0 0 / 15%);
    }

    /* Block button (full width) */
    .btn-block {
        width: 100%;
    }

    /* Normal size */
    .btn-normal {
        font-size: 16px;
        height: 40px;
        line-height: 38px;
        padding: 0 40px;
    }

    /* Disabled */
    .btn:disabled, .btn.disabled {
        background: #EEE !important;
        border: 1px solid #DDD !important;
        text-shadow: 0 1px 1px white !important;
        color: #CCC !important;
        cursor: default !important;
        pointer-events: none;
    }
`;

export default {
    defaultFontFamily,
    defaultDialogCSS,
    defaultMessageCSS,
    defaultButtonCSS,
};
