import { getAppDataSource } from './db/datasource';
import {
    MetaSchema,
    ProgramEventSchema,
    ProgramSchema,
    SettingSchema,
    ZoneSchema,
    type MetaRecord,
    type ProgramEventRecord,
    type ProgramRecord,
    type SettingRecord,
    type ZoneRecord
} from './db/entities';
import { ensureRuntimeWorkersStarted } from './runtime';
import { DEFAULT_DURATION_MINUTES, createId, normalizeState, type IrrigationAppState } from '../shared';

type ProgramEventLevel = 'info' | 'warning' | 'error';

let bootstrapPromise: Promise<void> | null = null;

export async function readAppState(): Promise<IrrigationAppState> {
    await ensureStorageBootstrapped();
    await ensureRuntimeWorkersStarted();

    const dataSource = await getAppDataSource();
    const programRepository = dataSource.getRepository(ProgramSchema);
    const zoneRepository = dataSource.getRepository(ZoneSchema);
    const settingRepository = dataSource.getRepository(SettingSchema);
    const metaRepository = dataSource.getRepository(MetaSchema);

    const [programRows, settingRows, metaRows] = await Promise.all([
        programRepository.find({ order: { sortOrder: 'ASC' } }),
        settingRepository.find(),
        metaRepository.find()
    ]);

    const settingsMap = toValueMap(settingRows);
    const metaMap = toValueMap(metaRows);

    const programs = await Promise.all(
        programRows.map(async (programRow) => {
            const zones = await zoneRepository.find({
                where: { programId: programRow.id },
                order: { sortOrder: 'ASC' }
            });

            return {
                id: programRow.id,
                name: programRow.name,
                enabled: programRow.enabled,
                startTime: programRow.startTime,
                days: parseDaysCsv(programRow.daysCsv),
                zones: zones.map((zone) => ({
                    id: zone.id,
                    entityId: zone.entityId,
                    label: zone.label,
                    durationMinutes: zone.durationMinutes,
                    enabled: zone.enabled
                }))
            };
        })
    );

    return normalizeState({
        settings: {
            homeAssistantUrl: settingsMap.homeAssistantUrl ?? '',
            accessToken: settingsMap.accessToken ?? '',
            defaultDurationMinutes: Number(settingsMap.defaultDurationMinutes)
        },
        programs,
        updatedAt: metaMap.updatedAt ?? new Date().toISOString()
    });
}

export async function writeAppState(state: IrrigationAppState): Promise<IrrigationAppState> {
    await ensureStorageBootstrapped();
    await ensureRuntimeWorkersStarted();

    const normalizedState = normalizeState({
        ...state,
        updatedAt: new Date().toISOString()
    });

    return persistAppState(normalizedState);
}

async function persistAppState(normalizedState: IrrigationAppState): Promise<IrrigationAppState> {
    const dataSource = await getAppDataSource();

    await dataSource.transaction(async (manager) => {
        await manager.getRepository(ZoneSchema).clear();
        await manager.getRepository(ProgramSchema).clear();
        await manager.getRepository(SettingSchema).clear();
        await manager.getRepository(MetaSchema).clear();

        const programRows: ProgramRecord[] = [];
        const zoneRows: ZoneRecord[] = [];

        normalizedState.programs.forEach((program, programIndex) => {
            programRows.push({
                id: program.id,
                name: program.name,
                enabled: program.enabled,
                startTime: program.startTime,
                daysCsv: program.days.join(','),
                sortOrder: programIndex
            });

            program.zones.forEach((zone, zoneIndex) => {
                zoneRows.push({
                    id: zone.id,
                    programId: program.id,
                    entityId: zone.entityId,
                    label: zone.label,
                    durationMinutes: zone.durationMinutes,
                    enabled: zone.enabled,
                    sortOrder: zoneIndex
                });
            });
        });

        const settingRows: SettingRecord[] = [
            { key: 'homeAssistantUrl', value: normalizedState.settings.homeAssistantUrl },
            { key: 'accessToken', value: normalizedState.settings.accessToken },
            { key: 'defaultDurationMinutes', value: String(normalizedState.settings.defaultDurationMinutes) }
        ];

        const metaRows: MetaRecord[] = [{ key: 'updatedAt', value: normalizedState.updatedAt }];

        if (programRows.length > 0) {
            await manager.getRepository(ProgramSchema).save(programRows);
        }
        if (zoneRows.length > 0) {
            await manager.getRepository(ZoneSchema).save(zoneRows);
        }

        await manager.getRepository(SettingSchema).save(settingRows);
        await manager.getRepository(MetaSchema).save(metaRows);
    });

    return normalizedState;
}

export async function logProgramEvent(
    message: string,
    options: { programId?: string | null; level?: ProgramEventLevel; payload?: unknown } = {}
): Promise<void> {
    await ensureStorageBootstrapped();
    await ensureRuntimeWorkersStarted();

    const dataSource = await getAppDataSource();
    const eventRepository = dataSource.getRepository(ProgramEventSchema);

    const eventRow: ProgramEventRecord = {
        id: createId(),
        programId: options.programId ?? null,
        level: options.level ?? 'info',
        message,
        payload: options.payload === undefined ? null : JSON.stringify(options.payload),
        createdAt: new Date().toISOString()
    };

    await eventRepository.save(eventRow);
}

export interface ProgramEventView {
    id: string;
    programId: string | null;
    level: ProgramEventLevel;
    message: string;
    payload: unknown;
    createdAt: string;
}

export async function readProgramEvents(programId: string, limit = 100): Promise<ProgramEventView[]> {
    await ensureStorageBootstrapped();
    await ensureRuntimeWorkersStarted();

    const dataSource = await getAppDataSource();
    const eventRepository = dataSource.getRepository(ProgramEventSchema);

    const rows = await eventRepository.find({
        where: { programId },
        order: { createdAt: 'DESC' },
        take: Math.max(1, Math.min(500, Math.round(limit)))
    });

    return rows.map((row) => ({
        id: row.id,
        programId: row.programId,
        level: row.level,
        message: row.message,
        payload: parseEventPayload(row.payload),
        createdAt: row.createdAt
    }));
}

async function ensureStorageBootstrapped(): Promise<void> {
    if (!bootstrapPromise) {
        bootstrapPromise = bootstrapStateIfNeeded();
    }

    await bootstrapPromise;
}

async function bootstrapStateIfNeeded(): Promise<void> {
    const dataSource = await getAppDataSource();
    const [programCount, settingsCount] = await Promise.all([
        dataSource.getRepository(ProgramSchema).count(),
        dataSource.getRepository(SettingSchema).count()
    ]);

    if (programCount > 0 || settingsCount > 0) {
        return;
    }

    const initialState = normalizeState({
        settings: {
            homeAssistantUrl: '',
            accessToken: '',
            defaultDurationMinutes: DEFAULT_DURATION_MINUTES
        },
        programs: [],
        updatedAt: new Date().toISOString()
    });

    await persistAppState(initialState);
}

function toValueMap(rows: Array<SettingRecord | MetaRecord>): Record<string, string> {
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function parseDaysCsv(daysCsv: string): string[] {
    if (!daysCsv.trim()) {
        return [];
    }

    return daysCsv.split(',').map((day) => day.trim());
}

function parseEventPayload(payload: string | null): unknown {
    if (!payload) {
        return null;
    }

    try {
        return JSON.parse(payload);
    } catch {
        return payload;
    }
}
