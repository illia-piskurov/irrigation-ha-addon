import { WEEKDAYS, type Weekday } from '../shared';
import { getAppDataSource } from './db/datasource';
import {
    ProgramEventSchema,
    ProgramRunSchema,
    ProgramSchema,
    ZoneSchema,
    type ProgramEventRecord,
    type ProgramRunRecord,
    type ProgramRunStatus
} from './db/entities';
import { turnSwitchOff, turnSwitchOn } from './ha-service';

const SCHEDULER_TICK_MS = 30_000;
const EXECUTOR_TICK_MS = 5_000;
const RETRY_DELAY_MS = 2 * 60 * 1000;

let workersStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let executorTimer: ReturnType<typeof setInterval> | null = null;
let schedulerBusy = false;
let executorBusy = false;

export interface ProgramRuntimeSummary {
    programId: string;
    status: 'idle' | 'queued' | 'running';
    scheduledFor: string | null;
    nextZoneIndex: number | null;
    activeZoneId: string | null;
    retryAt: string | null;
    lastError: string | null;
}

export async function ensureRuntimeWorkersStarted(): Promise<void> {
    if (workersStarted) {
        return;
    }

    workersStarted = true;

    await recoverStaleRuns();

    schedulerTimer = setInterval(() => {
        void schedulerTick();
    }, SCHEDULER_TICK_MS);

    executorTimer = setInterval(() => {
        void executorTick();
    }, EXECUTOR_TICK_MS);

    void schedulerTick();
    void executorTick();
}

export function areRuntimeWorkersActive(): boolean {
    return Boolean(workersStarted && schedulerTimer && executorTimer);
}

export async function readRuntimeSummary(): Promise<ProgramRuntimeSummary[]> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);
    const programRepository = dataSource.getRepository(ProgramSchema);

    const [runs, programs] = await Promise.all([
        runRepository.find({
            where: [{ status: 'running' }, { status: 'pending' }],
            order: { scheduledFor: 'ASC', createdAt: 'ASC' }
        }),
        programRepository.find({ select: { id: true } })
    ]);

    const byProgram = new Map<string, ProgramRuntimeSummary>();

    for (const run of runs) {
        const existing = byProgram.get(run.programId);
        if (existing) {
            continue;
        }

        byProgram.set(run.programId, {
            programId: run.programId,
            status: run.status === 'running' ? 'running' : 'queued',
            scheduledFor: run.scheduledFor,
            nextZoneIndex: run.nextZoneIndex,
            activeZoneId: run.activeZoneId,
            retryAt: run.retryAt,
            lastError: run.lastError
        });
    }

    for (const program of programs) {
        if (!byProgram.has(program.id)) {
            byProgram.set(program.id, {
                programId: program.id,
                status: 'idle',
                scheduledFor: null,
                nextZoneIndex: null,
                activeZoneId: null,
                retryAt: null,
                lastError: null
            });
        }
    }

    return Array.from(byProgram.values());
}

async function schedulerTick(): Promise<void> {
    if (schedulerBusy) {
        return;
    }

    schedulerBusy = true;

    try {
        const dataSource = await getAppDataSource();
        const programRepository = dataSource.getRepository(ProgramSchema);

        const programs = await programRepository.find({ where: { enabled: true } });
        const now = new Date();
        const currentMinute = formatHourMinute(now);
        const scheduledFor = toMinuteIso(now);
        const weekday = getWeekday(now);

        for (const program of programs) {
            if (program.startTime !== currentMinute) {
                continue;
            }

            const days = parseDaysCsv(program.daysCsv);
            if (!days.includes(weekday)) {
                continue;
            }

            await enqueueProgramRun(program.id, scheduledFor);
        }
    } catch (error) {
        console.error('[Runtime] schedulerTick failed:', stringifyError(error));
    } finally {
        schedulerBusy = false;
    }
}

async function enqueueProgramRun(programId: string, scheduledFor: string): Promise<void> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);

    const run: ProgramRunRecord = {
        id: crypto.randomUUID(),
        programId,
        scheduledFor,
        status: 'pending',
        nextZoneIndex: 0,
        retryCount: 0,
        retryAt: null,
        activeZoneId: null,
        lastError: null,
        hadErrors: false,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString()
    };

    try {
        await runRepository.insert(run);
        await writeProgramEvent('Program run queued', {
            programId,
            level: 'info',
            payload: { scheduledFor }
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) {
            throw error;
        }
    }
}

async function executorTick(): Promise<void> {
    if (executorBusy) {
        return;
    }

    executorBusy = true;

    try {
        const run = await findNextRunnableRun();
        if (!run) {
            return;
        }

        await executeRun(run.id);
    } catch (error) {
        console.error('[Runtime] executorTick failed:', stringifyError(error));
    } finally {
        executorBusy = false;
    }
}

async function findNextRunnableRun(): Promise<ProgramRunRecord | null> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);
    const nowIso = new Date().toISOString();

    return runRepository
        .createQueryBuilder('run')
        .where('run.status = :status', { status: 'pending' })
        .andWhere('(run.retryAt IS NULL OR run.retryAt <= :nowIso)', { nowIso })
        .orderBy('run.scheduledFor', 'ASC')
        .addOrderBy('run.createdAt', 'ASC')
        .getOne();
}

async function executeRun(runId: string): Promise<void> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);
    const programRepository = dataSource.getRepository(ProgramSchema);
    const zoneRepository = dataSource.getRepository(ZoneSchema);

    const run = await runRepository.findOneBy({ id: runId });
    if (!run || run.status !== 'pending') {
        return;
    }

    const nowIso = new Date().toISOString();
    run.status = 'running';
    run.startedAt = run.startedAt ?? nowIso;
    run.updatedAt = nowIso;
    await runRepository.save(run);

    const program = await programRepository.findOneBy({ id: run.programId });
    if (!program || !program.enabled) {
        await finishRun(run, 'completed_with_errors', 'Program missing or disabled before execution');
        return;
    }

    const zones = (await zoneRepository.find({
        where: { programId: run.programId },
        order: { sortOrder: 'ASC' }
    })).filter((zone) => zone.enabled && zone.entityId.startsWith('switch.'));

    if (zones.length === 0 || run.nextZoneIndex >= zones.length) {
        await finishRun(run, run.hadErrors ? 'completed_with_errors' : 'completed');
        return;
    }

    for (let index = run.nextZoneIndex; index < zones.length; index += 1) {
        const zone = zones[index];
        run.nextZoneIndex = index;
        run.activeZoneId = zone.id;
        run.updatedAt = new Date().toISOString();
        await runRepository.save(run);

        await writeProgramEvent('Zone started', {
            programId: run.programId,
            level: 'info',
            payload: { zoneId: zone.id, entityId: zone.entityId, attempt: run.retryCount + 1 }
        });

        try {
            await executeZone(run.programId, zone.id, zone.entityId, zone.durationMinutes);

            run.retryCount = 0;
            run.retryAt = null;
            run.lastError = null;
            run.nextZoneIndex = index + 1;
            run.activeZoneId = null;
            run.updatedAt = new Date().toISOString();
            await runRepository.save(run);

            await writeProgramEvent('Zone completed', {
                programId: run.programId,
                level: 'info',
                payload: { zoneId: zone.id, entityId: zone.entityId }
            });
        } catch (error) {
            const message = stringifyError(error);

            if (run.retryCount < 1) {
                run.status = 'pending';
                run.retryCount += 1;
                run.retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
                run.lastError = message;
                run.updatedAt = new Date().toISOString();
                await runRepository.save(run);

                await writeProgramEvent('Zone failed, retry scheduled', {
                    programId: run.programId,
                    level: 'warning',
                    payload: {
                        zoneId: zone.id,
                        entityId: zone.entityId,
                        retryAt: run.retryAt,
                        error: message
                    }
                });
                return;
            }

            run.hadErrors = true;
            run.retryCount = 0;
            run.retryAt = null;
            run.lastError = message;
            run.nextZoneIndex = index + 1;
            run.activeZoneId = null;
            run.updatedAt = new Date().toISOString();
            await runRepository.save(run);

            await writeProgramEvent('Zone skipped after retry failure', {
                programId: run.programId,
                level: 'error',
                payload: { zoneId: zone.id, entityId: zone.entityId, error: message }
            });
        }
    }

    await finishRun(run, run.hadErrors ? 'completed_with_errors' : 'completed');
}

async function finishRun(run: ProgramRunRecord, status: ProgramRunStatus, errorMessage?: string): Promise<void> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);

    run.status = status;
    run.completedAt = new Date().toISOString();
    run.activeZoneId = null;
    run.retryAt = null;
    run.retryCount = 0;
    if (errorMessage) {
        run.hadErrors = true;
        run.lastError = errorMessage;
    }
    run.updatedAt = run.completedAt;
    await runRepository.save(run);

    await writeProgramEvent(
        status === 'completed' ? 'Program run completed' : 'Program run completed with errors',
        {
            programId: run.programId,
            level: status === 'completed' ? 'info' : 'warning',
            payload: {
                runId: run.id,
                scheduledFor: run.scheduledFor,
                lastError: run.lastError
            }
        }
    );
}

async function executeZone(
    programId: string,
    zoneId: string,
    entityId: string,
    durationMinutes: number,
): Promise<void> {
    let switchEnabled = false;

    try {
        const turnOnResult = await turnSwitchOn(entityId);
        switchEnabled = true;
        await writeProgramEvent('Switch turned on', {
            programId,
            level: 'info',
            payload: {
                zoneId,
                entityId,
                state: turnOnResult.state
            }
        });
        await delay(durationMinutes * 60_000);
    } catch (error) {
        await writeProgramEvent('Switch turn on failed', {
            programId,
            level: 'error',
            payload: {
                zoneId,
                entityId,
                error: stringifyError(error)
            }
        });
        throw error;
    } finally {
        if (switchEnabled) {
            try {
                const turnOffResult = await turnSwitchOff(entityId);
                await writeProgramEvent('Switch turned off', {
                    programId,
                    level: 'info',
                    payload: {
                        zoneId,
                        entityId,
                        state: turnOffResult.state
                    }
                });
            } catch (error) {
                await writeProgramEvent('Switch turn off failed', {
                    programId,
                    level: 'error',
                    payload: {
                        zoneId,
                        entityId,
                        error: stringifyError(error)
                    }
                });
                throw error;
            }
        }
    }
}

async function recoverStaleRuns(): Promise<void> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);

    const staleRuns = await runRepository.find({ where: { status: 'running' } });
    if (staleRuns.length === 0) {
        return;
    }

    for (const staleRun of staleRuns) {
        staleRun.status = 'pending';
        staleRun.hadErrors = true;
        staleRun.retryCount = 0;
        staleRun.retryAt = new Date().toISOString();
        staleRun.activeZoneId = null;
        staleRun.nextZoneIndex += 1;
        staleRun.lastError = 'Runtime restarted during execution; skipped interrupted zone';
        staleRun.updatedAt = new Date().toISOString();
        await runRepository.save(staleRun);

        await writeProgramEvent('Run resumed after restart, interrupted zone skipped', {
            programId: staleRun.programId,
            level: 'warning',
            payload: {
                runId: staleRun.id,
                nextZoneIndex: staleRun.nextZoneIndex,
                scheduledFor: staleRun.scheduledFor
            }
        });
    }
}

async function writeProgramEvent(
    message: string,
    options: { programId: string; level: 'info' | 'warning' | 'error'; payload?: unknown }
): Promise<void> {
    const dataSource = await getAppDataSource();
    const eventRepository = dataSource.getRepository(ProgramEventSchema);

    const row: ProgramEventRecord = {
        id: crypto.randomUUID(),
        programId: options.programId,
        level: options.level,
        message,
        payload: options.payload === undefined ? null : JSON.stringify(options.payload),
        createdAt: new Date().toISOString()
    };

    await eventRepository.save(row);
}

function parseDaysCsv(daysCsv: string): Weekday[] {
    if (!daysCsv.trim()) {
        return [];
    }

    return daysCsv
        .split(',')
        .map((day) => day.trim())
        .filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday));
}

function getWeekday(date: Date): Weekday {
    const dayIndex = date.getDay();
    const map: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return map[dayIndex] ?? 'mon';
}

function formatHourMinute(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toMinuteIso(date: Date): string {
    const copy = new Date(date);
    copy.setSeconds(0, 0);
    return copy.toISOString();
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown runtime error';
}

function isUniqueConstraintError(error: unknown): boolean {
    const message = stringifyError(error).toLowerCase();
    return message.includes('unique') || message.includes('constraint');
}
