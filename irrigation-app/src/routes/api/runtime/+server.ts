import { json, type RequestHandler } from '@sveltejs/kit';

import {
    areRuntimeWorkersActive,
    ensureRuntimeWorkersStarted,
    readRuntimeSummary,
    startProgramNow,
    startZoneNow,
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
        | { action?: string; programId?: string; zoneId?: string }
        | null;

    if (!body || typeof body.action !== 'string' || typeof body.programId !== 'string' || !body.programId) {
        return json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
    }

    if (body.action === 'skip-zone') {
        const skipped = await skipActiveZone(body.programId);
        if (!skipped) {
            return json({ ok: false, error: 'Нет активной зоны для пропуска' }, { status: 404 });
        }

        return json({ ok: true });
    }

    if (body.action === 'start-program') {
        const result = await startProgramNow(body.programId);
        if (!result.ok) {
            return json({ ok: false, error: result.error ?? 'Не удалось запустить программу' }, { status: result.status });
        }

        return json({ ok: true });
    }

    if (body.action === 'start-zone') {
        if (typeof body.zoneId !== 'string' || !body.zoneId) {
            return json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
        }

        const result = await startZoneNow(body.programId, body.zoneId);
        if (!result.ok) {
            return json({ ok: false, error: result.error ?? 'Не удалось запустить зону' }, { status: result.status });
        }

        return json({ ok: true });
    }

    return json({ ok: false, error: 'Неподдерживаемое действие' }, { status: 400 });
};
