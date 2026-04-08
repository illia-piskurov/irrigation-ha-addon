import { json, type RequestHandler } from '@sveltejs/kit';

import {
    areRuntimeWorkersActive,
    ensureRuntimeWorkersStarted,
    readRuntimeSummary,
    skipActiveZone
} from '$lib/server/runtime';

export const GET: RequestHandler = async () => {
    await ensureRuntimeWorkersStarted();
    const items = await readRuntimeSummary();

    return json({
        workersActive: areRuntimeWorkersActive(),
        items
    });
};

export const POST: RequestHandler = async ({ request }) => {
    await ensureRuntimeWorkersStarted();

    const body = (await request.json().catch(() => null)) as
        | { action?: string; programId?: string }
        | null;

    if (!body || body.action !== 'skip-zone' || typeof body.programId !== 'string' || !body.programId) {
        return json({ ok: false, error: 'Invalid payload' }, { status: 400 });
    }

    const skipped = await skipActiveZone(body.programId);
    if (!skipped) {
        return json({ ok: false, error: 'No active zone to skip' }, { status: 404 });
    }

    return json({ ok: true });
};
