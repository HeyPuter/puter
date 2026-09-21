import { describe, expect, it } from 'vitest';

globalThis.window = { html_encode: (v) => String(v).replace(/[<"]/g, (c) => (c === '<' ? '&lt;' : '&quot;')) };

const { teamActionButton, TEAM_ACTION_ICONS } = await import('./teamActionIcons.js');

describe('an icon action button', () => {
    it('keeps the label reachable without showing it', () => {
        // Dropping the visible text must not drop it for a screen reader.
        const h = teamActionButton({
            className: 'teams-reset',
            icon: 'credential',
            label: 'Reissue password',
        });
        expect(h).toContain('title="Reissue password"');
        expect(h).toContain('aria-label="Reissue password"');
        expect(h).toContain('<span class="sr-only">Reissue password</span>');
    });

    it('carries the class the click handler binds to', () => {
        const h = teamActionButton({ className: 'teams-disable', icon: 'suspend', label: 'x' });
        expect(h).toContain('teams-disable');
    });

    it('passes through the data attributes an action needs', () => {
        const h = teamActionButton({
            className: 'teams-plan-change',
            icon: 'plan',
            label: 'Change plan',
            attrs: { 'data-username': 'ana', 'data-uuid': 'u-1' },
        });
        expect(h).toContain('data-username="ana"');
        expect(h).toContain('data-uuid="u-1"');
    });

    it('marks only the destructive ones', () => {
        expect(teamActionButton({ className: 'a', icon: 'remove', label: 'x', danger: true }))
            .toContain('button-danger');
        expect(teamActionButton({ className: 'a', icon: 'plan', label: 'x' }))
            .not.toContain('button-danger');
    });

    it('encodes a label and an attribute value', () => {
        const h = teamActionButton({
            className: 'a',
            icon: 'plan',
            label: '<script>',
            attrs: { 'data-username': '"quoted' },
        });
        expect(h).not.toContain('<script>');
        expect(h).not.toContain('data-username=""quoted"');
    });

    it('renders an empty glyph rather than breaking on an unknown icon', () => {
        const h = teamActionButton({ className: 'a', icon: 'nope', label: 'x' });
        expect(h).toContain('<button');
        expect(h).not.toContain('undefined');
    });

    it('hides every glyph from the accessibility tree', () => {
        // The label is on the button; the svg would be noise.
        for (const svg of Object.values(TEAM_ACTION_ICONS)) {
            expect(svg).toContain('aria-hidden="true"');
        }
    });
});
