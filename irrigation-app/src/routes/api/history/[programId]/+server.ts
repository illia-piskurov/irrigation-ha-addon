import { json, type RequestHandler } from '@sveltejs/kit';

import { readProgramEvents } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params, url }) => {
    const programId = (params.programId ?? '').trim();

    if (!programId) {
        return json({ error: 'Program id is required' }, { status: 400 });
    }

    const limitValue = url.searchParams.get('limit');
    const limit = limitValue ? Number(limitValue) : 100;
    const events = await readProgramEvents(programId, Number.isFinite(limit) ? limit : 100);

    return json({ events });
};
