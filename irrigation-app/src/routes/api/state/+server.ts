import { json, type RequestHandler } from '@sveltejs/kit';

import { logProgramEvent, readAppState, writeAppState } from '$lib/server/storage';
import { normalizeState } from '$lib/shared';

export const GET: RequestHandler = async () => {
    const state = await readAppState();
    return json({ state });
};

export const PUT: RequestHandler = async ({ request }) => {
    const payload = await request.json().catch(() => null);
    const state = normalizeState(payload);
    const savedState = await writeAppState(state);

    await logProgramEvent('State was saved', {
        level: 'info',
        payload: { programs: savedState.programs.length }
    });

    return json({ state: savedState });
};