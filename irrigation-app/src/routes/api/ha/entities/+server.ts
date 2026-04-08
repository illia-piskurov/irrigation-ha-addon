import { json, type RequestHandler } from '@sveltejs/kit';

import { fetchHaEntities } from '$lib/server/ha-ws';

export const GET: RequestHandler = async () => {
    try {
        const entities = await fetchHaEntities();
        return json({ entities, source: 'websocket', connected: true });
    } catch (error) {
        console.error('[HA WS] Failed to fetch entities:', stringifyError(error));
        return json(
            {
                entities: [],
                source: 'websocket',
                connected: false,
                error: stringifyError(error)
            },
            { status: 503 }
        );
    }
};

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}