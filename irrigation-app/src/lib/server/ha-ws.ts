import { humanizeIdentifier } from '$lib/shared';

export interface HaStateItem {
    entity_id?: string;
    state?: string;
    attributes?: {
        friendly_name?: string;
    };
}

export interface HaEntityOption {
    entityId: string;
    label: string;
}

const DEFAULT_WS_URL = 'ws://supervisor/core/websocket';
const ALT_WS_URL = 'ws://supervisor/core/api/websocket';
const SUPPORTED_DOMAINS = new Set(['switch']);
const REQUEST_TIMEOUT_MS = 4500;

export async function fetchHaEntities(): Promise<HaEntityOption[]> {
    const states = await fetchHaStates();
    return mapStateItemsToEntities(states);
}

export async function fetchSwitchState(
    entityId: string,
    accessToken?: string,
): Promise<string | null> {
    const states = await fetchHaStates(accessToken);
    const match = states.find((state) => state.entity_id === entityId);
    return match?.state ?? null;
}

export async function fetchHaStates(accessToken?: string): Promise<HaStateItem[]> {
    const token = accessToken ?? resolveHaAccessToken();
    if (!token) {
        throw new Error('Home Assistant access token is not available');
    }

    const wsUrls = buildWsUrls();
    console.info(`[HA WS] Trying ${wsUrls.length} endpoint(s): ${wsUrls.join(', ')}`);

    let lastError: unknown;
    for (const wsUrl of wsUrls) {
        try {
            console.info(`[HA WS] Connecting: ${wsUrl}`);
            return await fetchStatesFromSingleWsEndpoint(wsUrl, token);
        } catch (error) {
            console.warn(`[HA WS] Endpoint failed (${wsUrl}): ${stringifyError(error)}`);
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('No websocket endpoint responded');
}

function resolveHaAccessToken(): string {
    return (
        process.env.SUPERVISOR_TOKEN ??
        process.env.HASSIO_TOKEN ??
        process.env.HOME_ASSISTANT_TOKEN ??
        ''
    );
}

function fetchStatesFromSingleWsEndpoint(
    wsUrl: string,
    accessToken: string,
): Promise<HaStateItem[]> {
    return new Promise<HaStateItem[]>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const requestId = 1;

        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error(`Home Assistant websocket timed out: ${wsUrl}`));
        }, REQUEST_TIMEOUT_MS);

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
                        access_token: accessToken,
                    }),
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
                        type: 'get_states',
                    }),
                );
                return;
            }

            if (message.id === requestId && message.type === 'result') {
                cleanup();
                socket.close();
                console.info(`[HA WS] get_states success: ${wsUrl}, states=${(message.result ?? []).length}`);
                resolve(message.result ?? []);
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
                    humanizeIdentifier(entityId),
            } satisfies HaEntityOption;
        })
        .sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}
