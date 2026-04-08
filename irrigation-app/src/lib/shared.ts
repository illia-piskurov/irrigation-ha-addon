export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export interface ZoneCatalogEntry {
    id: string;
    groupId: string;
    groupLabel: string;
    entityId: string;
    label: string;
    order: number;
}

export interface IrrigationZone {
    id: string;
    entityId: string;
    label: string;
    durationMinutes: number;
    enabled: boolean;
}

export interface IrrigationProgram {
    id: string;
    name: string;
    enabled: boolean;
    startTime: string;
    days: Weekday[];
    zones: IrrigationZone[];
}

export interface IrrigationSettings {
    homeAssistantUrl: string;
    accessToken: string;
    defaultDurationMinutes: number;
}

export interface IrrigationAppState {
    settings: IrrigationSettings;
    programs: IrrigationProgram[];
    updatedAt: string;
}

export const DEFAULT_DURATION_MINUTES = 10;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
    mon: 'Пн',
    tue: 'Вт',
    wed: 'Ср',
    thu: 'Чт',
    fri: 'Пт',
    sat: 'Сб',
    sun: 'Вс'
};

export function humanizeIdentifier(identifier: string): string {
    return identifier
        .replace(/^switch\./, '')
        .replace(/[_\.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function clampDurationMinutes(value: number, fallback = DEFAULT_DURATION_MINUTES): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(240, Math.max(1, Math.round(value)));
}

export function createId(): string {
    const randomUuid = globalThis.crypto?.randomUUID;

    if (typeof randomUuid === 'function') {
        return randomUuid.call(globalThis.crypto);
    }

    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyProgram(): IrrigationProgram {
    return {
        id: createId(),
        name: 'Новая программа',
        enabled: true,
        startTime: '06:00',
        days: ['mon', 'wed', 'fri'],
        zones: []
    };
}

export function createZoneFromCatalog(entry: ZoneCatalogEntry, durationMinutes = DEFAULT_DURATION_MINUTES): IrrigationZone {
    return {
        id: createId(),
        entityId: entry.entityId,
        label: entry.label,
        durationMinutes: clampDurationMinutes(durationMinutes),
        enabled: true
    };
}

export function createEmptyZone(durationMinutes = DEFAULT_DURATION_MINUTES): IrrigationZone {
    return {
        id: createId(),
        entityId: '',
        label: 'Зона',
        durationMinutes: clampDurationMinutes(durationMinutes),
        enabled: true
    };
}

export function buildCatalogLookup(entries: ZoneCatalogEntry[]): Record<string, ZoneCatalogEntry> {
    return Object.fromEntries(entries.map((entry) => [entry.id, entry]));
}

export function groupByCatalogGroup(entries: ZoneCatalogEntry[]): Array<{ groupId: string; groupLabel: string; zones: ZoneCatalogEntry[] }> {
    const groups = new Map<string, { groupId: string; groupLabel: string; zones: ZoneCatalogEntry[] }>();

    for (const entry of entries) {
        const group = groups.get(entry.groupId);
        if (group) {
            group.zones.push(entry);
            continue;
        }

        groups.set(entry.groupId, {
            groupId: entry.groupId,
            groupLabel: entry.groupLabel,
            zones: [entry]
        });
    }

    return Array.from(groups.values());
}

export function normalizeState(candidate: unknown): IrrigationAppState {
    const raw = candidate as Partial<IrrigationAppState> | undefined;
    const settings = (raw?.settings ?? {}) as Record<string, unknown>;
    const programs = Array.isArray(raw?.programs) ? raw.programs : [];

    return {
        settings: {
            homeAssistantUrl: typeof settings.homeAssistantUrl === 'string' ? settings.homeAssistantUrl : '',
            accessToken: typeof settings.accessToken === 'string' ? settings.accessToken : '',
            defaultDurationMinutes: clampDurationMinutes(
                typeof settings.defaultDurationMinutes === 'number' ? settings.defaultDurationMinutes : DEFAULT_DURATION_MINUTES
            )
        },
        programs: programs.map(normalizeProgram),
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
    };
}

function normalizeProgram(program: Partial<IrrigationProgram>): IrrigationProgram {
    return {
        id: typeof program.id === 'string' && program.id ? program.id : createId(),
        name: typeof program.name === 'string' && program.name.trim() ? program.name.trim() : 'Новая программа',
        enabled: typeof program.enabled === 'boolean' ? program.enabled : true,
        startTime: typeof program.startTime === 'string' && /^\d{2}:\d{2}$/.test(program.startTime) ? program.startTime : '06:00',
        days: normalizeDays(program.days),
        zones: Array.isArray(program.zones) ? program.zones.map(normalizeZone) : []
    };
}

function normalizeZone(zone: Partial<IrrigationZone>): IrrigationZone {
    return {
        id: typeof zone.id === 'string' && zone.id ? zone.id : createId(),
        entityId: typeof zone.entityId === 'string' ? zone.entityId.trim() : '',
        label: typeof zone.label === 'string' && zone.label.trim() ? zone.label.trim() : 'Зона',
        durationMinutes: clampDurationMinutes(
            typeof zone.durationMinutes === 'number' ? zone.durationMinutes : DEFAULT_DURATION_MINUTES
        ),
        enabled: typeof zone.enabled === 'boolean' ? zone.enabled : true
    };
}

function normalizeDays(days: unknown): Weekday[] {
    const fallback: Weekday[] = ['mon', 'wed', 'fri'];

    if (!Array.isArray(days)) {
        return fallback;
    }

    const normalized = days.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}