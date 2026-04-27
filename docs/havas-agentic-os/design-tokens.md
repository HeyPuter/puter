# Havas Agentic OS Design Tokens

The token source lives in `src/gui/src/havas-agentic-os/design-tokens.js`. It mirrors the current CXOS desktop visual contract without editing `UICXOSDesktop.js`.

## Token Groups

- Color: Havas red, dark shell surfaces, text, borders, and status accents.
- Space: compact desktop, dock, chat, and workspace increments.
- Radius: small controls, app icons, panels, and round dock/chat controls.
- Shadow: red glow, dock lift, and chat panel elevation.
- Motion: short hover/press transitions used by the current desktop surface.

## Usage

Import `havasAgenticOSTokens` for structured values or inject `havasAgenticOSCSSVariables` where CSS custom properties are required.
