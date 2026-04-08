import { json, type RequestHandler } from '@sveltejs/kit';

import { createSeedState } from '$lib/seed';
import { humanizeIdentifier } from '$lib/shared';

interface HaStateItem {
    entity_id?: string;
    attributes?: {
        friendly_name?: string;
    };
}

interface HaEntityOption {
    entityId: string;
    label: string;
}

const DEFAULT_WS_URL = 'ws://supervisor/core/websocket';
const SUPPORTED_DOMAINS = new Set(['switch', 'valve', 'input_boolean']);

export const GET: RequestHandler = async () => {
    try {
        const entities = await fetchEntitiesFromHomeAssistant();
        return json({ entities, source: 'websocket' });
    } catch {
        const entities = createSeedEntityFallback();
        return json({ entities, source: 'seed-fallback' });
    }
};

async function fetchEntitiesFromHomeAssistant(): Promise<HaEntityOption[]> {
    const accessToken =
        process.env.SUPERVISOR_TOKEN ??
        process.env.HASSIO_TOKEN ??
        process.env.HOME_ASSISTANT_TOKEN;
    if (!accessToken) {
        throw new Error('Home Assistant access token is not available');
    }

    const wsUrl = process.env.HOMEASSISTANT_WS_URL ?? DEFAULT_WS_URL;

    return new Promise<HaEntityOption[]>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const requestId = 1;

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Home Assistant websocket request timed out'));
        }, 4500);

        const cleanup = () => {
            clearTimeout(timeout);
        };

        socket.addEventListener('error', () => {
            cleanup();
            reject(new Error('Home Assistant websocket error'));
        });

        socket.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data)) as {
                type?: string;
                id?: number;
                result?: HaStateItem[];
            };

            if (message.type === 'auth_required') {
                socket.send(
                    JSON.stringify({
                        type: 'auth',
                        access_token: accessToken
                    })
                );
                return;
            }

            if (message.type === 'auth_invalid') {
                cleanup();
                socket.close();
                reject(new Error('Home Assistant websocket auth failed'));
                return;
            }

            if (message.type === 'auth_ok') {
                socket.send(
                    JSON.stringify({
                        id: requestId,
                        type: 'get_states'
                    })
                );
                return;
            }

            if (message.id === requestId && message.type === 'result') {
                cleanup();
                socket.close();

                const entities = (message.result ?? [])
                    .filter((state) => {
                        const entityId = state.entity_id ?? '';
                        const domain = entityId.split('.')[0] ?? '';
                        return entityId.includes('.') && SUPPORTED_DOMAINS.has(domain);
                    })
                    .map((state) => {
                        const entityId = state.entity_id ?? '';
                        return {
                            entityId,
                            label:
                                state.attributes?.friendly_name?.trim() ||
                                humanizeIdentifier(entityId)
                        } satisfies HaEntityOption;
                    })
                    .sort((left, right) => left.entityId.localeCompare(right.entityId));

                resolve(entities);
            }
        });
    });
}

function createSeedEntityFallback(): HaEntityOption[] {
    const seen = new Set<string>();
    const entities: HaEntityOption[] = [];

    for (const program of createSeedState().programs) {
        for (const zone of program.zones) {
            if (seen.has(zone.entityId)) {
                continue;
            }

            seen.add(zone.entityId);
            entities.push({
                entityId: zone.entityId,
                label: zone.label
            });
        }
    }

    return entities.sort((left, right) => left.entityId.localeCompare(right.entityId));
}