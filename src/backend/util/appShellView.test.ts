import { describe, expect, it } from 'vitest';
import { toAppShellView } from './appShellView.js';

const rawRow = () => ({
    id: 42,
    uid: 'app-1234',
    name: 'cool-app',
    title: 'Cool App',
    description: 'does things',
    icon: 'data:image/png;base64,AAA',
    index_url: 'https://cool-app.site.example.com/',
    owner_user_id: 7,
    background: 1,
    maximize_on_start: 0,
    godmode: 1,
    is_private: 0,
    protected: 1,
    approved_for_listing: 1,
    approved_for_opening_items: 0,
    approved_for_incentive_program: 1,
    metadata: { social_image: 'https://example.com/og.png' },
    created_at: 1700000000,
});

describe('toAppShellView', () => {
    it('returns null for a missing row', () => {
        expect(toAppShellView(null)).toBeNull();
        expect(toAppShellView(undefined)).toBeNull();
    });

    it('never carries the launch URL or ownership/internal columns', () => {
        const view = toAppShellView(rawRow()) as Record<string, unknown>;

        for (const leaked of ['index_url', 'owner_user_id', 'id']) {
            expect(view).not.toHaveProperty(leaked);
        }
    });

    it('exposes exactly the agreed field set', () => {
        const view = toAppShellView(rawRow()) as Record<string, unknown>;

        expect(Object.keys(view).sort()).toEqual(
            [
                'approved_for_incentive_program',
                'approved_for_listing',
                'approved_for_opening_items',
                'background',
                'created_at',
                'description',
                'godmode',
                'icon',
                'is_private',
                'maximize_on_start',
                'metadata',
                'name',
                'protected',
                'title',
                'uid',
            ].sort(),
        );
    });

    it('normalizes flag columns to booleans', () => {
        const view = toAppShellView(rawRow())!;

        expect(view.background).toBe(true);
        expect(view.maximize_on_start).toBe(false);
        expect(view.godmode).toBe(true);
        expect(view.is_private).toBe(false);
        expect(view.protected).toBe(true);
        expect(view.approved_for_listing).toBe(true);
        expect(view.approved_for_opening_items).toBe(false);
        expect(view.approved_for_incentive_program).toBe(true);
    });

    it('falls back to the legacy `timestamp` column for created_at', () => {
        const { created_at: _dropped, ...withoutCreatedAt } = rawRow();
        const view = toAppShellView({
            ...withoutCreatedAt,
            timestamp: 1650000000,
        })!;

        expect(view.created_at).toBe(1650000000);
    });

    it('defaults absent metadata to null rather than undefined', () => {
        const { metadata: _dropped, ...withoutMetadata } = rawRow();

        expect(toAppShellView(withoutMetadata)!.metadata).toBeNull();
    });
});
