import { WEEKDAYS, createId, type Weekday } from '../shared';
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

class ZoneSkippedError extends Error {
    constructor(message = 'Zone skipped by user') {
        super(message);
        this.name = 'ZoneSkippedError';
    }
}

let workersStarted = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let executorTimer: ReturnType<typeof setInterval> | null = null;
let schedulerBusy = false;
let executorBusy = false;
const activeRunExecutions = new Set<string>();
const activeProgramExecutions = new Set<string>();
const activeZoneAbortControllers = new Map<string, AbortController>();
const activeZoneMetaByRunId = new Map<
    string,
    { programId: string; zoneId: string; startedAt: string; durationMinutes: number }
>();
const userSkippedRunIds = new Set<string>();

function runtimePriority(status: ProgramRuntimeSummary['status']): number {
    if (status === 'running') {
        return 2;
    }
    if (status === 'queued') {
        return 1;
    }
    return 0;
}

export interface ProgramRuntimeSummary {
    programId: string;
    status: 'idle' | 'queued' | 'running';
    scheduledFor: string | null;
    nextZoneIndex: number | null;
    activeZoneId: string | null;
    activeZoneStartedAt: string | null;
    activeZoneDurationMinutes: number | null;
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
    const zoneRepository = dataSource.getRepository(ZoneSchema);

    const [runs, programs, zones] = await Promise.all([
        runRepository.find({
            where: [{ status: 'running' }, { status: 'pending' }],
            order: { scheduledFor: 'ASC', createdAt: 'ASC' }
        }),
        programRepository.find({ select: { id: true } }),
        zoneRepository.find({ select: { id: true, durationMinutes: true } })
    ]);

    const durationByZoneId = new Map<string, number>();
    for (const zone of zones) {
        durationByZoneId.set(zone.id, zone.durationMinutes);
    }

    const byProgram = new Map<string, ProgramRuntimeSummary>();

    for (const run of runs) {
        const nextStatus: ProgramRuntimeSummary['status'] = run.status === 'running' ? 'running' : 'queued';
        const existing = byProgram.get(run.programId);
        if (existing && runtimePriority(existing.status) >= runtimePriority(nextStatus)) {
            continue;
        }

        byProgram.set(run.programId, {
            programId: run.programId,
            status: nextStatus,
            scheduledFor: run.scheduledFor,
            nextZoneIndex: run.nextZoneIndex,
            activeZoneId: run.activeZoneId,
            activeZoneStartedAt: activeZoneMetaByRunId.get(run.id)?.startedAt ?? null,
            activeZoneDurationMinutes:
                activeZoneMetaByRunId.get(run.id)?.durationMinutes ??
                (run.activeZoneId ? (durationByZoneId.get(run.activeZoneId) ?? null) : null),
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
                activeZoneStartedAt: null,
                activeZoneDurationMinutes: null,
                retryAt: null,
                lastError: null
            });
        }
    }

    return Array.from(byProgram.values());
}

export async function skipActiveZone(programId: string): Promise<boolean> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);

    const run = await runRepository
        .createQueryBuilder('run')
        .where('run.programId = :programId', { programId })
        .andWhere('run.status = :status', { status: 'running' })
        .orderBy('run.updatedAt', 'DESC')
        .getOne();

    if (!run || !run.activeZoneId) {
        return false;
    }

    userSkippedRunIds.add(run.id);
    activeZoneAbortControllers.get(run.id)?.abort();
    return true;
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
        id: createId(),
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
        const [runs, runningProgramIds] = await Promise.all([
            findRunnableRuns(),
            findRunningProgramIds()
        ]);

        if (runs.length === 0) {
            return;
        }

        const busyProgramIds = new Set<string>([
            ...runningProgramIds,
            ...activeProgramExecutions
        ]);

        for (const run of runs) {
            if (activeRunExecutions.has(run.id)) {
                continue;
            }

            if (busyProgramIds.has(run.programId)) {
                continue;
            }

            busyProgramIds.add(run.programId);
            dispatchRunExecution(run.id, run.programId);
        }
    } catch (error) {
        console.error('[Runtime] executorTick failed:', stringifyError(error));
    } finally {
        executorBusy = false;
    }
}

function dispatchRunExecution(runId: string, programId: string): void {
    activeRunExecutions.add(runId);
    activeProgramExecutions.add(programId);

    void executeRun(runId)
        .catch((error) => {
            console.error('[Runtime] executeRun failed:', stringifyError(error));
        })
        .finally(() => {
            activeRunExecutions.delete(runId);
            activeProgramExecutions.delete(programId);
        });
}

async function findRunnableRuns(): Promise<ProgramRunRecord[]> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);
    const nowIso = new Date().toISOString();

    return runRepository
        .createQueryBuilder('run')
        .where('run.status = :status', { status: 'pending' })
        .andWhere('(run.retryAt IS NULL OR run.retryAt <= :nowIso)', { nowIso })
        .orderBy('run.scheduledFor', 'ASC')
        .addOrderBy('run.createdAt', 'ASC')
        .getMany();
}

async function findRunningProgramIds(): Promise<Set<string>> {
    const dataSource = await getAppDataSource();
    const runRepository = dataSource.getRepository(ProgramRunSchema);

    const runningRuns = await runRepository.find({
        where: { status: 'running' },
        select: { programId: true }
    });

    return new Set(runningRuns.map((run) => run.programId));
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
        userSkippedRunIds.delete(run.id);
        run.nextZoneIndex = index;
        run.activeZoneId = zone.id;
        run.updatedAt = new Date().toISOString();
        await runRepository.save(run);
        activeZoneMetaByRunId.set(run.id, {
            programId: run.programId,
            zoneId: zone.id,
            startedAt: new Date().toISOString(),
            durationMinutes: zone.durationMinutes
        });

        await writeProgramEvent('Zone started', {
            programId: run.programId,
            level: 'info',
            payload: { zoneId: zone.id, entityId: zone.entityId, attempt: run.retryCount + 1 }
        });

        try {
            await executeZone(run.id, run.programId, zone.id, zone.entityId, zone.durationMinutes);

            run.retryCount = 0;
            run.retryAt = null;
            run.lastError = null;
            run.nextZoneIndex = index + 1;
            run.activeZoneId = null;
            run.updatedAt = new Date().toISOString();
            await runRepository.save(run);
            activeZoneMetaByRunId.delete(run.id);

            await writeProgramEvent('Zone completed', {
                programId: run.programId,
                level: 'info',
                payload: { zoneId: zone.id, entityId: zone.entityId }
            });
        } catch (error) {
            if (error instanceof ZoneSkippedError || userSkippedRunIds.has(run.id)) {
                userSkippedRunIds.delete(run.id);
                run.retryCount = 0;
                run.retryAt = null;
                run.lastError = null;
                run.nextZoneIndex = index + 1;
                run.activeZoneId = null;
                run.updatedAt = new Date().toISOString();
                await runRepository.save(run);
                activeZoneMetaByRunId.delete(run.id);

                await writeProgramEvent('Zone skipped by user', {
                    programId: run.programId,
                    level: 'info',
                    payload: { zoneId: zone.id, entityId: zone.entityId }
                });
                continue;
            }

            const message = stringifyError(error);

            if (run.retryCount < 1) {
                run.status = 'pending';
                run.retryCount += 1;
                run.retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
                run.lastError = message;
                run.updatedAt = new Date().toISOString();
                await runRepository.save(run);
                activeZoneMetaByRunId.delete(run.id);

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
            activeZoneMetaByRunId.delete(run.id);

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
    activeZoneAbortControllers.delete(run.id);
    activeZoneMetaByRunId.delete(run.id);
    userSkippedRunIds.delete(run.id);

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
    runId: string,
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
        if (userSkippedRunIds.has(runId)) {
            throw new ZoneSkippedError();
        }
        await delayWithAbort(runId, durationMinutes * 60_000);
    } catch (error) {
        if (error instanceof ZoneSkippedError) {
            throw error;
        }
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
        try {
            if (switchEnabled) {
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
            }
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
        } finally {
            activeZoneAbortControllers.delete(runId);
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
        activeZoneAbortControllers.delete(staleRun.id);
        activeZoneMetaByRunId.delete(staleRun.id);
        userSkippedRunIds.delete(staleRun.id);
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
        id: createId(),
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

function delayWithAbort(runId: string, milliseconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        activeZoneAbortControllers.set(runId, controller);

        const timeoutId = setTimeout(() => {
            activeZoneAbortControllers.delete(runId);
            resolve();
        }, milliseconds);

        controller.signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeoutId);
                activeZoneAbortControllers.delete(runId);
                reject(new ZoneSkippedError());
            },
            { once: true }
        );
    });
}

function stringifyError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown runtime error';
}

function isUniqueConstraintError(error: unknown): boolean {
    const message = stringifyError(error).toLowerCase();
    return message.includes('unique') || message.includes('constraint');
}
