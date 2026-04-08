const SERVICE_TIMEOUT_MS = 8000;

export async function turnSwitchOn(entityId: string): Promise<void> {
    await callSwitchService(entityId, 'turn_on');
}

export async function turnSwitchOff(entityId: string): Promise<void> {
    await callSwitchService(entityId, 'turn_off');
}

async function callSwitchService(entityId: string, action: 'turn_on' | 'turn_off'): Promise<void> {
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
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error(`HA service ${action} timed out for ${entityId}`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function isAbortError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}
