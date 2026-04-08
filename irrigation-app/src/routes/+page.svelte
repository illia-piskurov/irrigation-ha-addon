<script lang="ts">
    import { browser } from "$app/environment";
    import { base } from "$app/paths";
    import {
        DEFAULT_DURATION_MINUTES,
        WEEKDAYS,
        WEEKDAY_LABELS,
        createEmptyProgram,
        createEmptyZone,
        humanizeIdentifier,
        normalizeState,
        type IrrigationAppState,
        type IrrigationProgram,
        type Weekday,
    } from "$lib";
    import type { PageData } from "./$types";

    type Props = { data: PageData };

    type ProgramRuntimeSummary = {
        programId: string;
        status: "idle" | "queued" | "running";
        scheduledFor: string | null;
        nextZoneIndex: number | null;
        activeZoneId: string | null;
        retryAt: string | null;
        lastError: string | null;
    };

    let { data }: Props = $props();

    let draft = $state<IrrigationAppState>(normalizeState(undefined));
    let expandedProgramId = $state("");
    let lastPersistedSignature = $state("");
    let saveDebounce: ReturnType<typeof setTimeout> | undefined;
    let haEntities = $state<Array<{ entityId: string; label: string }>>([]);
    let haEntitiesLoaded = $state(false);
    let haEntitiesSource = $state("loading");
    let haConnectionStatus = $state<"checking" | "connected" | "error">(
        "checking",
    );
    let haConnectionMessage = $state(
        "Проверяем подключение к Home Assistant...",
    );
    let activeZoneAutocompleteId = $state("");
    let runtimeByProgramId = $state<Record<string, ProgramRuntimeSummary>>({});
    const HOURS = Array.from({ length: 24 }, (_, value) =>
        value.toString().padStart(2, "0"),
    );
    const MINUTES = Array.from({ length: 60 }, (_, value) =>
        value.toString().padStart(2, "0"),
    );

    $effect(() => {
        if (lastPersistedSignature !== "") {
            return;
        }

        draft = structuredClone(data.state);
        expandedProgramId = data.state.programs[0]?.id ?? "";
        lastPersistedSignature = JSON.stringify(data.state);
    });

    $effect(() => {
        const snapshot = JSON.stringify(draft);

        if (snapshot === lastPersistedSignature || !browser) {
            return;
        }

        if (saveDebounce) {
            clearTimeout(saveDebounce);
        }

        saveDebounce = setTimeout(() => {
            void persist(snapshot);
        }, 450);

        return () => {
            if (saveDebounce) {
                clearTimeout(saveDebounce);
            }
        };
    });

    $effect(() => {
        if (!browser || haEntitiesLoaded) {
            return;
        }

        haEntitiesLoaded = true;
        void loadHaEntities();
        void loadRuntimeStatus();

        const interval = setInterval(() => {
            void loadRuntimeStatus();
        }, 15_000);

        return () => {
            clearInterval(interval);
        };
    });

    function markExpanded(programId: string) {
        expandedProgramId = expandedProgramId === programId ? "" : programId;
    }

    function addProgram() {
        const program = createEmptyProgram();
        draft.programs = [program, ...draft.programs];
        expandedProgramId = program.id;
    }

    function removeProgram(programId: string) {
        draft.programs = draft.programs.filter(
            (program) => program.id !== programId,
        );
        if (expandedProgramId === programId) {
            expandedProgramId = draft.programs[0]?.id ?? "";
        }
    }

    function addZone(program: IrrigationProgram) {
        program.zones = [
            ...program.zones,
            createEmptyZone(
                draft.settings.defaultDurationMinutes ||
                    DEFAULT_DURATION_MINUTES,
            ),
        ];
    }

    function removeZone(program: IrrigationProgram, zoneId: string) {
        program.zones = program.zones.filter((zone) => zone.id !== zoneId);
    }

    function moveZone(
        program: IrrigationProgram,
        zoneIndex: number,
        direction: -1 | 1,
    ) {
        const targetIndex = zoneIndex + direction;
        if (targetIndex < 0 || targetIndex >= program.zones.length) {
            return;
        }

        const nextZones = [...program.zones];
        const [zone] = nextZones.splice(zoneIndex, 1);
        nextZones.splice(targetIndex, 0, zone);
        program.zones = nextZones;
    }

    function toggleDay(program: IrrigationProgram, day: Weekday) {
        program.days = program.days.includes(day)
            ? program.days.filter((value) => value !== day)
            : [...program.days, day].sort(
                  (left, right) =>
                      WEEKDAYS.indexOf(left) - WEEKDAYS.indexOf(right),
              );
    }

    function updateProgramName(program: IrrigationProgram, value: string) {
        program.name = value;
    }

    function updateZoneEntity(
        zone: { entityId: string; label: string },
        value: string,
    ) {
        const nextValue = value.trim();
        const matchedByEntity = collectEntityOptions().find(
            (entity) => entity.entityId === nextValue,
        );
        const matchedByLabel = collectEntityOptions().find(
            (entity) => entity.label.toLowerCase() === nextValue.toLowerCase(),
        );
        const matched = matchedByEntity ?? matchedByLabel;

        if (matched) {
            zone.entityId = matched.entityId;
            zone.label = matched.label;
            return;
        }

        const looksLikeEntityId = /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(nextValue);
        if (looksLikeEntityId) {
            zone.entityId = nextValue;
            zone.label = humanizeIdentifier(nextValue);
            return;
        }

        zone.label = value;
    }

    function collectEntityOptions(): Array<{
        entityId: string;
        label: string;
    }> {
        const merged = new Map<string, string>();

        for (const entity of haEntities) {
            if (!entity.entityId.startsWith("switch.")) {
                continue;
            }

            merged.set(entity.entityId, entity.label);
        }

        for (const program of draft.programs) {
            for (const zone of program.zones) {
                if (!zone.entityId) {
                    continue;
                }

                if (!zone.entityId.startsWith("switch.")) {
                    continue;
                }

                if (!merged.has(zone.entityId)) {
                    merged.set(
                        zone.entityId,
                        zone.label || humanizeIdentifier(zone.entityId),
                    );
                }
            }
        }

        return Array.from(merged.entries())
            .map(([entityId, label]) => ({ entityId, label }))
            .sort((left, right) => left.entityId.localeCompare(right.entityId));
    }

    function getEntitySuggestions(zone: { entityId: string; label: string }) {
        const query = (zone.label || zone.entityId).trim().toLowerCase();
        const options = collectEntityOptions();

        if (!query) {
            return options.slice(0, 8);
        }

        return options
            .filter(
                (entity) =>
                    entity.entityId.toLowerCase().includes(query) ||
                    entity.label.toLowerCase().includes(query),
            )
            .slice(0, 12);
    }

    function selectEntitySuggestion(
        zone: { entityId: string; label: string },
        entityId: string,
    ) {
        updateZoneEntity(zone, entityId);
        activeZoneAutocompleteId = "";
    }

    function getZoneDisplayValue(zone: { entityId: string; label: string }) {
        return zone.label || humanizeIdentifier(zone.entityId);
    }

    function closeAutocompleteDeferred() {
        setTimeout(() => {
            activeZoneAutocompleteId = "";
        }, 120);
    }

    function updateStartTime(
        program: IrrigationProgram,
        part: "hour" | "minute",
        value: string,
    ) {
        const [hour = "06", minute = "00"] = program.startTime.split(":");
        const nextHour = part === "hour" ? value : hour;
        const nextMinute = part === "minute" ? value : minute;
        program.startTime = `${nextHour}:${nextMinute}`;
    }

    function getStartHour(program: IrrigationProgram): string {
        return program.startTime.split(":")[0] ?? "06";
    }

    function getStartMinute(program: IrrigationProgram): string {
        return program.startTime.split(":")[1] ?? "00";
    }

    function formatProgramDays(days: Weekday[]): string {
        if (days.length === 7) {
            return "Каждый день";
        }

        return days.map((day) => WEEKDAY_LABELS[day]).join(", ");
    }

    async function persist(snapshot: string) {
        if (!browser) {
            return;
        }

        try {
            const response = await fetch(`${base}/api/state`, {
                method: "PUT",
                headers: {
                    "content-type": "application/json",
                },
                body: snapshot,
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const payload = (await response.json()) as {
                state: IrrigationAppState;
            };
            draft.updatedAt = payload.state.updatedAt;
            lastPersistedSignature = snapshot;
        } catch (error) {
            console.error("State persistence failed", error);
        }
    }

    async function loadHaEntities() {
        try {
            const response = await fetch(`${base}/api/ha/entities`);
            const payload = (await response.json()) as {
                entities: Array<{ entityId: string; label: string }>;
                source?: string;
                connected?: boolean;
                error?: string;
            };

            if (!response.ok || payload.connected === false) {
                haEntities = [];
                haEntitiesSource = payload.source ?? "websocket";
                haConnectionStatus = "error";
                haConnectionMessage =
                    payload.error ??
                    "Не удалось подключиться к Home Assistant по WebSocket";
                return;
            }

            haEntities = payload.entities;
            haEntitiesSource = payload.source ?? "unknown";
            haConnectionStatus = "connected";
            haConnectionMessage = `Подключено к Home Assistant (${haEntities.length} сущностей)`;
        } catch {
            haEntities = [];
            haEntitiesSource = "websocket";
            haConnectionStatus = "error";
            haConnectionMessage =
                "Не удалось подключиться к Home Assistant по WebSocket";
        }
    }

    async function loadRuntimeStatus() {
        try {
            const response = await fetch(`${base}/api/runtime`);
            if (!response.ok) {
                throw new Error(await response.text());
            }

            const payload = (await response.json()) as {
                items: ProgramRuntimeSummary[];
            };

            runtimeByProgramId = Object.fromEntries(
                payload.items.map((item) => [item.programId, item]),
            );
        } catch (error) {
            console.error("Runtime status fetch failed", error);
        }
    }

    function getProgramRuntimeText(programId: string): string {
        const runtime = runtimeByProgramId[programId];

        if (!runtime || runtime.status === "idle") {
            return "Статус: ожидание";
        }

        if (runtime.status === "running") {
            const zonePart =
                runtime.nextZoneIndex === null
                    ? ""
                    : ` · зона ${runtime.nextZoneIndex + 1}`;
            const errorPart = runtime.lastError
                ? ` · ошибка: ${runtime.lastError}`
                : "";
            return `Статус: выполняется${zonePart}${errorPart}`;
        }

        const retryPart = runtime.retryAt
            ? ` · retry ${new Date(runtime.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "";
        return `Статус: в очереди${retryPart}`;
    }
</script>

<svelte:head>
    <title>Irrigation Manager</title>
    <meta
        name="description"
        content="Lightweight irrigation program manager for Home Assistant switches"
    />
</svelte:head>

<div class="shell">
    <div class="layout">
        <main class="main-column">
            <div
                class="ha-health"
                class:ha-health-ok={haConnectionStatus === "connected"}
                class:ha-health-error={haConnectionStatus === "error"}
                class:ha-health-checking={haConnectionStatus === "checking"}
            >
                <strong>Home Assistant:</strong>
                {haConnectionMessage}
            </div>

            {#if draft.programs.length === 0}
                <section class="empty-state">
                    <h2>Пока нет программ</h2>
                    <p>
                        Добавьте первую программу и настройте её расписание и
                        зоны.
                    </p>
                    <button class="primary" type="button" onclick={addProgram}
                        >Создать программу</button
                    >
                </section>
            {:else}
                {#each draft.programs as program, index (program.id)}
                    <section class="program-card">
                        <button
                            class="program-header"
                            type="button"
                            onclick={() => markExpanded(program.id)}
                        >
                            <div>
                                <p class="program-index">
                                    Программа {index + 1}
                                </p>
                                <h2>{program.name}</h2>
                                <p class="program-meta">
                                    {program.startTime} · {formatProgramDays(
                                        program.days,
                                    )} · {program.zones.length} зон
                                </p>
                                <p class="program-runtime">
                                    {getProgramRuntimeText(program.id)}
                                </p>
                            </div>
                            <span class="caret"
                                >{expandedProgramId === program.id
                                    ? "▴"
                                    : "▾"}</span
                            >
                        </button>

                        {#if expandedProgramId === program.id}
                            <div class="program-body">
                                <div class="program-toolbar">
                                    <label class="toggle">
                                        <input
                                            type="checkbox"
                                            bind:checked={program.enabled}
                                        />
                                        <span>Включена</span>
                                    </label>
                                    <div class="toolbar-actions">
                                        <button
                                            type="button"
                                            class="danger"
                                            onclick={() =>
                                                removeProgram(program.id)}
                                            >Удалить</button
                                        >
                                    </div>
                                </div>

                                <div class="form-grid">
                                    <label>
                                        <span>Название программы</span>
                                        <input
                                            type="text"
                                            bind:value={program.name}
                                            oninput={(event) =>
                                                updateProgramName(
                                                    program,
                                                    (
                                                        event.currentTarget as HTMLInputElement
                                                    ).value,
                                                )}
                                        />
                                    </label>
                                    <label>
                                        <span>Время старта</span>
                                        <div class="time-input-group">
                                            <select
                                                value={getStartHour(program)}
                                                onchange={(event) =>
                                                    updateStartTime(
                                                        program,
                                                        "hour",
                                                        (
                                                            event.currentTarget as HTMLSelectElement
                                                        ).value,
                                                    )}
                                            >
                                                {#each HOURS as option}
                                                    <option value={option}
                                                        >{option}</option
                                                    >
                                                {/each}
                                            </select>
                                            <span class="time-separator">:</span
                                            >
                                            <select
                                                value={getStartMinute(program)}
                                                onchange={(event) =>
                                                    updateStartTime(
                                                        program,
                                                        "minute",
                                                        (
                                                            event.currentTarget as HTMLSelectElement
                                                        ).value,
                                                    )}
                                            >
                                                {#each MINUTES as option}
                                                    <option value={option}
                                                        >{option}</option
                                                    >
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
                                            bind:value={
                                                draft.settings
                                                    .defaultDurationMinutes
                                            }
                                        />
                                    </label>
                                </div>

                                <div class="weekday-row">
                                    {#each WEEKDAYS as day}
                                        <button
                                            type="button"
                                            class:selected={program.days.includes(
                                                day,
                                            )}
                                            onclick={() =>
                                                toggleDay(program, day)}
                                        >
                                            {WEEKDAY_LABELS[day]}
                                        </button>
                                    {/each}
                                </div>

                                <div class="zone-list">
                                    <div class="zone-list-header">
                                        <h3>Зоны</h3>
                                        <p>
                                            Последовательный запуск, по одной
                                            зоне за раз.
                                        </p>
                                    </div>

                                    {#if program.zones.length === 0}
                                        <div class="empty-zones">
                                            Нет зон. Добавьте первую ниже.
                                        </div>
                                    {/if}

                                    {#each program.zones as zone, zoneIndex (zone.id)}
                                        <div class="zone-row">
                                            <div class="zone-main">
                                                <label>
                                                    <span
                                                        >Сущность HA (entity_id)</span
                                                    >
                                                    <small class="entity-source"
                                                        >Источник: {haEntitiesSource}</small
                                                    >
                                                    <div
                                                        class="entity-autocomplete"
                                                    >
                                                        <input
                                                            type="text"
                                                            value={getZoneDisplayValue(
                                                                zone,
                                                            )}
                                                            placeholder="Начните вводить имя или entity_id"
                                                            onfocus={() =>
                                                                (activeZoneAutocompleteId =
                                                                    zone.id)}
                                                            onblur={closeAutocompleteDeferred}
                                                            oninput={(event) =>
                                                                updateZoneEntity(
                                                                    zone,
                                                                    (
                                                                        event.currentTarget as HTMLInputElement
                                                                    ).value,
                                                                )}
                                                        />
                                                        <small
                                                            class="entity-id-value"
                                                            >ID: {zone.entityId ||
                                                                "не выбран"}</small
                                                        >

                                                        {#if activeZoneAutocompleteId === zone.id}
                                                            {@const suggestions =
                                                                getEntitySuggestions(
                                                                    zone,
                                                                )}
                                                            {#if suggestions.length > 0}
                                                                <div
                                                                    class="entity-suggestions"
                                                                >
                                                                    {#each suggestions as suggestion}
                                                                        <button
                                                                            type="button"
                                                                            class="entity-suggestion"
                                                                            onmousedown={() =>
                                                                                selectEntitySuggestion(
                                                                                    zone,
                                                                                    suggestion.entityId,
                                                                                )}
                                                                        >
                                                                            <span
                                                                                >{suggestion.label}</span
                                                                            >
                                                                            <small
                                                                                >{suggestion.entityId}</small
                                                                            >
                                                                        </button>
                                                                    {/each}
                                                                </div>
                                                            {/if}
                                                        {/if}
                                                    </div>
                                                </label>
                                                <label>
                                                    <span>Минуты</span>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="240"
                                                        bind:value={
                                                            zone.durationMinutes
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <div class="zone-actions">
                                                <label class="toggle">
                                                    <input
                                                        type="checkbox"
                                                        bind:checked={
                                                            zone.enabled
                                                        }
                                                    />
                                                    <span>Вкл</span>
                                                </label>
                                                <button
                                                    type="button"
                                                    class="ghost"
                                                    onclick={() =>
                                                        moveZone(
                                                            program,
                                                            zoneIndex,
                                                            -1,
                                                        )}>↑</button
                                                >
                                                <button
                                                    type="button"
                                                    class="ghost"
                                                    onclick={() =>
                                                        moveZone(
                                                            program,
                                                            zoneIndex,
                                                            1,
                                                        )}>↓</button
                                                >
                                                <button
                                                    type="button"
                                                    class="danger"
                                                    onclick={() =>
                                                        removeZone(
                                                            program,
                                                            zone.id,
                                                        )}>Удалить</button
                                                >
                                            </div>
                                        </div>
                                    {/each}

                                    <button
                                        type="button"
                                        class="secondary"
                                        onclick={() => addZone(program)}
                                        >Добавить пустую зону</button
                                    >
                                </div>
                            </div>
                        {/if}
                    </section>
                {/each}

                <div class="add-program-row">
                    <button class="primary" type="button" onclick={addProgram}
                        >+ Добавить программу</button
                    >
                </div>
            {/if}
        </main>
    </div>
</div>
