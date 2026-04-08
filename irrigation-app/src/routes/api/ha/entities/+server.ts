import { json, type RequestHandler } from '@sveltejs/kit';

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
const ALT_WS_URL = 'ws://supervisor/core/api/websocket';
const SUPPORTED_DOMAINS = new Set(['switch', 'valve', 'input_boolean']);

export const GET: RequestHandler = async () => {
    try {
        const entities = await fetchEntitiesFromHomeAssistant();
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

async function fetchEntitiesFromHomeAssistant(): Promise<HaEntityOption[]> {
    const accessToken =
        process.env.SUPERVISOR_TOKEN ??
        process.env.HASSIO_TOKEN ??
        process.env.HOME_ASSISTANT_TOKEN;
    if (!accessToken) {
        throw new Error('Home Assistant access token is not available');
    }

    const wsUrls = buildWsUrls();
    console.info(
        `[HA WS] Trying ${wsUrls.length} endpoint(s): ${wsUrls.join(', ')}`
    );

    let lastError: unknown;
    for (const wsUrl of wsUrls) {
        try {
            console.info(`[HA WS] Connecting: ${wsUrl}`);
            return await fetchEntitiesFromSingleWsEndpoint(wsUrl, accessToken);
        } catch (error) {
            console.warn(
                `[HA WS] Endpoint failed (${wsUrl}): ${stringifyError(error)}`
            );
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('No websocket endpoint responded');
}

function fetchEntitiesFromSingleWsEndpoint(wsUrl: string, accessToken: string): Promise<HaEntityOption[]> {
    return new Promise<HaEntityOption[]>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const requestId = 1;

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error(`Home Assistant websocket timed out: ${wsUrl}`));
        }, 4500);

        const cleanup = () => {
            clearTimeout(timeout);
        };

        socket.addEventListener('error', () => {
            cleanup();
            reject(new Error(`Home Assistant websocket error: ${wsUrl}`));
        });

        socket.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data)) as {
                type?: string;
                id?: number;
                result?: HaStateItem[];
            };

            if (message.type === 'auth_required') {
                console.info(`[HA WS] auth_required: ${wsUrl}`);
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
                reject(new Error(`Home Assistant websocket auth failed: ${wsUrl}`));
                return;
            }

            if (message.type === 'auth_ok') {
                console.info(`[HA WS] auth_ok: ${wsUrl}`);
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
                const entities = mapStateItemsToEntities(message.result ?? []);
                console.info(
                    `[HA WS] get_states success: ${wsUrl}, entities=${entities.length}`
                );
                resolve(entities);
            }
        });
    });
}

function buildWsUrls(): string[] {
    const urls: string[] = [];

    if (process.env.HOMEASSISTANT_WS_URL) {
        urls.push(process.env.HOMEASSISTANT_WS_URL);
    }

    urls.push(DEFAULT_WS_URL, ALT_WS_URL);

    return Array.from(new Set(urls));
}

function mapStateItemsToEntities(states: HaStateItem[]): HaEntityOption[] {
    return states
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
}

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}