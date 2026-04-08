<script lang="ts">
    import {
        WEEKDAYS,
        WEEKDAY_LABELS,
        type IrrigationProgram,
        type Weekday,
    } from "$lib";
    import EntityAutocomplete from "$lib/components/EntityAutocomplete.svelte";
    import ProgramHistoryDialog from "./ProgramHistoryDialog.svelte";

    type EntityOption = {
        entityId: string;
        label: string;
    };

    type ProgramRuntimeSummary = {
        programId: string;
        status: "idle" | "queued" | "running";
        scheduledFor: string | null;
        nextZoneIndex: number | null;
        activeZoneId: string | null;
        activeZoneStartedAt: string | null;
        activeZoneDurationMinutes: number | null;
        retryAt: string | null;
        lastError: string | null;
    };

    type Props = {
        program: IrrigationProgram;
        index: number;
        expanded: boolean;
        runtimeText: string;
        runtime: ProgramRuntimeSummary | null;
        entityOptions: EntityOption[];
        haEntitiesSource: string;
        defaultDurationMinutes: number;
        formatProgramDays: (days: Weekday[]) => string;
        getStartHour: (program: IrrigationProgram) => string;
        getStartMinute: (program: IrrigationProgram) => string;
        onToggleExpanded: () => void;
        onRemoveProgram: () => void;
        onAddZone: () => void;
        onRemoveZone: (zoneId: string) => void;
        onMoveZone: (zoneIndex: number, direction: -1 | 1) => void;
        onToggleDay: (day: Weekday) => void;
        onUpdateStartTime: (part: "hour" | "minute", value: string) => void;
        onUpdateDefaultDurationMinutes: (value: number) => void;
        onSkipActiveZone: () => Promise<void>;
        onUpdateZoneEntity: (
            zone: { entityId: string; label: string },
            value: string,
        ) => void;
    };

    let {
        program,
        index,
        expanded,
        runtimeText,
        runtime,
        entityOptions,
        haEntitiesSource,
        defaultDurationMinutes,
        formatProgramDays,
        getStartHour,
        getStartMinute,
        onToggleExpanded,
        onRemoveProgram,
        onAddZone,
        onRemoveZone,
        onMoveZone,
        onToggleDay,
        onUpdateStartTime,
        onUpdateDefaultDurationMinutes,
        onSkipActiveZone,
        onUpdateZoneEntity,
    }: Props = $props();

    let clockTickMs = $state(Date.now());
    let skipPending = $state(false);
    let skipError = $state("");

    const isProgramRunning = $derived(runtime?.status === "running");
    const activeZoneId = $derived(runtime?.activeZoneId ?? null);

    $effect(() => {
        if (!isProgramRunning || !runtime?.activeZoneStartedAt) {
            return;
        }

        const interval = setInterval(() => {
            clockTickMs = Date.now();
        }, 1000);

        return () => {
            clearInterval(interval);
        };
    });

    function getActiveProgressPercent(): number {
        if (
            !runtime?.activeZoneStartedAt ||
            !runtime.activeZoneDurationMinutes ||
            runtime.activeZoneDurationMinutes <= 0
        ) {
            return 0;
        }

        const startedAtMs = new Date(runtime.activeZoneStartedAt).getTime();
        if (!Number.isFinite(startedAtMs)) {
            return 0;
        }

        const totalMs = runtime.activeZoneDurationMinutes * 60_000;
        const elapsedMs = Math.max(0, clockTickMs - startedAtMs);
        return Math.min(100, (elapsedMs / totalMs) * 100);
    }

    async function handleSkipZone() {
        skipError = "";
        skipPending = true;

        try {
            await onSkipActiveZone();
        } catch (error) {
            skipError =
                error instanceof Error
                    ? error.message
                    : "Не удалось пропустить активную зону";
        } finally {
            skipPending = false;
        }
    }
</script>

<section class="program-card" class:program-card-running={isProgramRunning}>
    <div class="program-header">
        <button
            class="program-header-main"
            type="button"
            onclick={onToggleExpanded}
        >
            <div>
                <p class="program-index">Программа {index + 1}</p>
                <h2>{program.name}</h2>
                <p class="program-meta">
                    {program.startTime} · {formatProgramDays(program.days)} ·
                    {program.zones.length} зон
                </p>
                <p class="program-runtime">{runtimeText}</p>
                {#if isProgramRunning}
                    <div
                        class="program-progress-inline"
                        role="status"
                        aria-live="polite"
                    >
                        <span class="program-running-chip">💧 В процессе</span>
                        <div class="progress-track" aria-hidden="true">
                            <div
                                class="progress-fill"
                                style={`width: ${getActiveProgressPercent()}%`}
                            ></div>
                        </div>
                    </div>
                {/if}
            </div>
            <span class="caret">{expanded ? "▴" : "▾"}</span>
        </button>

        <div class="program-header-actions">
            <ProgramHistoryDialog
                programId={program.id}
                programName={program.name}
                buttonClass="ghost compact"
            />
            <button
                type="button"
                class="ghost compact"
                onclick={onToggleExpanded}
            >
                {expanded ? "Свернуть" : "Развернуть"}
            </button>
            <button
                type="button"
                class="danger compact"
                onclick={onRemoveProgram}
            >
                Удалить
            </button>
        </div>
    </div>

    {#if expanded}
        <div class="program-body">
            <div class="program-toolbar">
                <label class="toggle">
                    <input type="checkbox" bind:checked={program.enabled} />
                    <span>Включена</span>
                </label>
                {#if isProgramRunning && activeZoneId}
                    <button
                        type="button"
                        class="secondary"
                        onclick={() => void handleSkipZone()}
                        disabled={skipPending}
                    >
                        {skipPending
                            ? "Пропускаем..."
                            : "Пропустить активную зону"}
                    </button>
                {/if}
            </div>

            {#if skipError}
                <p class="history-state history-error">{skipError}</p>
            {/if}

            <div class="form-grid">
                <label>
                    <span>Название программы</span>
                    <input type="text" bind:value={program.name} />
                </label>
                <label>
                    <span>Время старта</span>
                    <div class="time-input-group">
                        <select
                            value={getStartHour(program)}
                            onchange={(event) =>
                                onUpdateStartTime(
                                    "hour",
                                    (event.currentTarget as HTMLSelectElement)
                                        .value,
                                )}
                        >
                            {#each Array.from( { length: 24 }, (_, value) => value
                                        .toString()
                                        .padStart(2, "0"), ) as option}
                                <option value={option}>{option}</option>
                            {/each}
                        </select>
                        <span class="time-separator">:</span>
                        <select
                            value={getStartMinute(program)}
                            onchange={(event) =>
                                onUpdateStartTime(
                                    "minute",
                                    (event.currentTarget as HTMLSelectElement)
                                        .value,
                                )}
                        >
                            {#each Array.from( { length: 60 }, (_, value) => value
                                        .toString()
                                        .padStart(2, "0"), ) as option}
                                <option value={option}>{option}</option>
                            {/each}
                        </select>
                    </div>
                </label>
                <label>
                    <span>Длительность по умолчанию</span>
                    <input
                        type="number"
                        min="1"
                        max="240"
                        value={defaultDurationMinutes}
                        oninput={(event) =>
                            onUpdateDefaultDurationMinutes(
                                Number(
                                    (event.currentTarget as HTMLInputElement)
                                        .value,
                                ),
                            )}
                    />
                </label>
            </div>

            <div class="weekday-row">
                {#each WEEKDAYS as day}
                    <button
                        type="button"
                        class:selected={program.days.includes(day)}
                        onclick={() => onToggleDay(day)}
                    >
                        {WEEKDAY_LABELS[day]}
                    </button>
                {/each}
            </div>

            <div class="zone-list">
                <div class="zone-list-header">
                    <h3>Зоны</h3>
                    <p>Последовательный запуск, по одной зоне за раз.</p>
                </div>

                {#if program.zones.length === 0}
                    <div class="empty-zones">
                        Нет зон. Добавьте первую ниже.
                    </div>
                {/if}

                {#each program.zones as zone, zoneIndex (zone.id)}
                    <div
                        class="zone-row"
                        class:zone-row-running={isProgramRunning &&
                            activeZoneId === zone.id}
                    >
                        <div class="zone-main">
                            <label>
                                <span>Сущность HA (entity_id)</span>
                                <EntityAutocomplete
                                    value={zone.label}
                                    entityId={zone.entityId}
                                    {entityOptions}
                                    source={haEntitiesSource}
                                    onValueChange={(value) =>
                                        onUpdateZoneEntity(zone, value)}
                                    onSelectEntityId={(entityId) =>
                                        onUpdateZoneEntity(zone, entityId)}
                                />
                            </label>
                            <label>
                                <span>Минуты</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="240"
                                    bind:value={zone.durationMinutes}
                                />
                            </label>
                        </div>

                        {#if isProgramRunning && activeZoneId === zone.id}
                            <div
                                class="zone-runtime-indicator"
                                role="status"
                                aria-live="polite"
                            >
                                <div class="zone-runtime-title">
                                    <span class="zone-runtime-icon">💧</span>
                                    <span>Зона выполняется</span>
                                    <strong
                                        >{Math.round(
                                            getActiveProgressPercent(),
                                        )}%</strong
                                    >
                                </div>
                                <div class="progress-track" aria-hidden="true">
                                    <div
                                        class="progress-fill"
                                        style={`width: ${getActiveProgressPercent()}%`}
                                    ></div>
                                </div>
                            </div>
                        {/if}

                        <div class="zone-actions">
                            <label class="toggle">
                                <input
                                    type="checkbox"
                                    bind:checked={zone.enabled}
                                />
                                <span>Вкл</span>
                            </label>
                            <button
                                type="button"
                                class="ghost"
                                onclick={() => onMoveZone(zoneIndex, -1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                class="ghost"
                                onclick={() => onMoveZone(zoneIndex, 1)}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                class="danger"
                                onclick={() => onRemoveZone(zone.id)}
                            >
                                Удалить
                            </button>
                        </div>
                    </div>
                {/each}

                <button type="button" class="secondary" onclick={onAddZone}>
                    Добавить пустую зону
                </button>
            </div>
        </div>
    {/if}
</section>
