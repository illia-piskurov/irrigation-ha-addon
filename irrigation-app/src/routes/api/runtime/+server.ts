import { json, type RequestHandler } from '@sveltejs/kit';

import { areRuntimeWorkersActive, ensureRuntimeWorkersStarted, readRuntimeSummary } from '$lib/server/runtime';

export const GET: RequestHandler = async () => {
    await ensureRuntimeWorkersStarted();
    const items = await readRuntimeSummary();

    return json({
        workersActive: areRuntimeWorkersActive(),
        items
    });
};
