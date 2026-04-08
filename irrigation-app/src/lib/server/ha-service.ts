import { fetchSwitchState } from './ha-ws';

const SERVICE_TIMEOUT_MS = 8000;
const STATE_VERIFY_TIMEOUT_MS = 5000;
const STATE_VERIFY_INTERVAL_MS = 250;

export type SwitchActionResult = {
    entityId: string;
    action: 'turn_on' | 'turn_off';
    state: string;
};

export async function turnSwitchOn(entityId: string): Promise<SwitchActionResult> {
    return callSwitchService(entityId, 'turn_on', 'on');
}

export async function turnSwitchOff(entityId: string): Promise<SwitchActionResult> {
    return callSwitchService(entityId, 'turn_off', 'off');
}

async function callSwitchService(
    entityId: string,
    action: 'turn_on' | 'turn_off',
    expectedState: 'on' | 'off',
): Promise<SwitchActionResult> {
    if (!entityId.startsWith('switch.')) {
        throw new Error(`Unsupported entity domain for runtime execution: ${entityId}`);
    }

    const token =
        process.env.SUPERVISOR_TOKEN ??
        process.env.HASSIO_TOKEN ??
        process.env.HOME_ASSISTANT_TOKEN;

    if (!token) {
        throw new Error('Home Assistant access token is not available');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, SERVICE_TIMEOUT_MS);

    try {
        const response = await fetch(`http://supervisor/core/api/services/switch/${action}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ entity_id: entityId }),
            signal: controller.signal
        });

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            throw new Error(`HA service ${action} failed (${response.status}): ${details || response.statusText}`);
        }

        const verifiedState = await waitForExpectedSwitchState(entityId, expectedState, token);
        return {
            entityId,
            action,
            state: verifiedState,
        };
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error(`HA service ${action} timed out for ${entityId}`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function waitForExpectedSwitchState(
    entityId: string,
    expectedState: 'on' | 'off',
    accessToken: string,
): Promise<string> {
    const deadline = Date.now() + STATE_VERIFY_TIMEOUT_MS;
    let lastSeenState = 'unknown';
    let lastError: unknown;

    while (Date.now() < deadline) {
        try {
            const currentState = await fetchSwitchState(entityId, accessToken);
            lastSeenState = currentState ?? 'unknown';

            if (currentState === expectedState) {
                return currentState;
            }
        } catch (error) {
            lastError = error;
        }

        await delay(STATE_VERIFY_INTERVAL_MS);
    }

    const errorDetails = lastError ? `; last websocket error: ${stringifyError(lastError)}` : '';
    throw new Error(
        `Expected ${entityId} to become ${expectedState}, but last observed state was ${lastSeenState}${errorDetails}`,
    );
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function isAbortError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown runtime error';
}
