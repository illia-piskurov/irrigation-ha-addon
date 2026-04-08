export type ProgramEvent = {
    id: string;
    programId: string | null;
    level: "info" | "warning" | "error";
    message: string;
    payload: unknown;
    createdAt: string;
};

export type HistoryFilter = "all" | "errors" | "switch-success";

export function formatHistoryTimestamp(value: string): string {
    return new Date(value).toLocaleString([], {
        dateStyle: "short",
        timeStyle: "medium",
    });
}

export function formatHistoryPayload(payload: unknown): string {
    if (payload === null || payload === undefined) {
        return "";
    }

    if (typeof payload === "string") {
        return payload;
    }

    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return String(payload);
    }
}

function getPayloadObject(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    return payload as Record<string, unknown>;
}

export function getZoneName(
    payload: unknown,
    zoneNameById: Record<string, string>,
    zoneNameByEntityId: Record<string, string>,
): string {
    const data = getPayloadObject(payload);
    if (!data) {
        return "Зона";
    }

    const zoneId = typeof data.zoneId === "string" ? data.zoneId : "";
    const entityId = typeof data.entityId === "string" ? data.entityId : "";

    if (zoneId && zoneNameById[zoneId]) {
        return zoneNameById[zoneId];
    }

    if (entityId && zoneNameByEntityId[entityId]) {
        return zoneNameByEntityId[entityId];
    }

    if (entityId) {
        return entityId;
    }

    return "Зона";
}

export function getUserMessage(
    event: ProgramEvent,
    zoneNameById: Record<string, string>,
    zoneNameByEntityId: Record<string, string>,
): string {
    const zoneName = getZoneName(event.payload, zoneNameById, zoneNameByEntityId);

    switch (event.message) {
        case "Switch turned on":
            return `${zoneName}: успешно включена`;
        case "Switch turned off":
            return `${zoneName}: успешно выключена`;
        case "Switch turn on failed":
            return `${zoneName}: не удалось включить`;
        case "Switch turn off failed":
            return `${zoneName}: не удалось выключить`;
        case "Zone started":
            return `${zoneName}: запуск`;
        case "Zone completed":
            return `${zoneName}: полив завершен`;
        case "Zone skipped by user":
            return `${zoneName}: пропущена пользователем`;
        case "Zone failed, retry scheduled":
            return `${zoneName}: ошибка, будет повтор`;
        case "Zone skipped after retry failure":
            return `${zoneName}: пропущена после ошибки`;
        case "Program run queued":
            return "Программа поставлена в очередь";
        case "Program run completed":
            return "Программа завершена успешно";
        case "Program run completed with errors":
            return "Программа завершена с ошибками";
        case "Run resumed after restart, interrupted zone skipped":
            return "После перезапуска выполнение продолжено";
        default:
            return "Событие программы";
    }
}

export function summarizePayload(
    event: ProgramEvent,
): string {
    const data = getPayloadObject(event.payload);
    if (!data) {
        return "";
    }

    const parts: string[] = [];

    if (event.message === "Switch turned on" || event.message === "Switch turned off") {
        parts.push("Результат: успешно");
    } else if (
        event.message === "Switch turn on failed" ||
        event.message === "Switch turn off failed" ||
        event.message === "Zone skipped after retry failure"
    ) {
        parts.push("Результат: ошибка");
    }

    if (typeof data.state === "string") {
        parts.push(
            `Состояние: ${data.state === "on" ? "включено" : data.state === "off" ? "выключено" : data.state}`,
        );
    }

    if (typeof data.retryAt === "string") {
        parts.push(
            `Повтор: ${new Date(data.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        );
    }

    if (typeof data.error === "string") {
        parts.push(`Ошибка: ${data.error}`);
    }

    return parts.join(" · ");
}

export function summarizeDeveloperDetails(
    payload: unknown,
    zoneNameById: Record<string, string>,
    zoneNameByEntityId: Record<string, string>,
): string {
    const data = getPayloadObject(payload);
    if (!data) {
        return "";
    }

    const parts: string[] = [];
    const zoneId = typeof data.zoneId === "string" ? data.zoneId : "";
    const entityId = typeof data.entityId === "string" ? data.entityId : "";

    if (zoneId) {
        parts.push(`Зона: ${getZoneName(payload, zoneNameById, zoneNameByEntityId)} (${zoneId})`);
    }

    if (entityId) {
        parts.push(`Сущность: ${zoneNameByEntityId[entityId] ?? entityId} (${entityId})`);
    }

    if (typeof data.state === "string") {
        parts.push(`Состояние: ${data.state}`);
    }

    if (typeof data.retryAt === "string") {
        parts.push(
            `Повтор: ${new Date(data.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        );
    }

    if (typeof data.error === "string") {
        parts.push(`Ошибка: ${data.error}`);
    }

    return parts.join(" · ");
}

export function getLevelLabel(level: ProgramEvent["level"]): string {
    if (level === "warning") {
        return "warning";
    }

    if (level === "error") {
        return "error";
    }

    return "info";
}

export function getLevelText(level: ProgramEvent["level"]): string {
    if (level === "warning") {
        return "предупреждение";
    }

    if (level === "error") {
        return "ошибка";
    }

    return "информация";
}

export function isSwitchSuccessEvent(event: ProgramEvent): boolean {
    return (
        event.level === "info" &&
        (event.message === "Switch turned on" || event.message === "Switch turned off")
    );
}

export function getVisibleEvents(events: ProgramEvent[], activeFilter: HistoryFilter): ProgramEvent[] {
    if (activeFilter === "errors") {
        return events.filter((event) => event.level === "error");
    }

    if (activeFilter === "switch-success") {
        return events.filter(isSwitchSuccessEvent);
    }

    return events;
}
