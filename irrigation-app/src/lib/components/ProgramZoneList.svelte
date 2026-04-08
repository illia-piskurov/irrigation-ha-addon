<script lang="ts">
    import type { IrrigationProgram } from "$lib";
    import EntityAutocomplete from "$lib/components/EntityAutocomplete.svelte";

    type EntityOption = {
        entityId: string;
        label: string;
    };

    type Props = {
        program: IrrigationProgram;
        entityOptions: EntityOption[];
        haEntitiesSource: string;
        isProgramRunning: boolean;
        activeZoneId: string | null;
        activeProgressPercent: number;
        onAddZone: () => void;
        onRemoveZone: (zoneId: string) => void;
        onMoveZone: (zoneIndex: number, direction: -1 | 1) => void;
        onUpdateZoneEntity: (
            zone: { entityId: string; label: string },
            value: string,
        ) => void;
    };

    let {
        program,
        entityOptions,
        haEntitiesSource,
        isProgramRunning,
        activeZoneId,
        activeProgressPercent,
        onAddZone,
        onRemoveZone,
        onMoveZone,
        onUpdateZoneEntity,
    }: Props = $props();
</script>

<div class="zone-list">
    <div class="zone-list-header">
        <h3>Зоны</h3>
        <p>Последовательный запуск, по одной зоне за раз.</p>
    </div>

    {#if program.zones.length === 0}
        <div class="empty-zones">Нет зон. Добавьте первую ниже.</div>
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
                        <strong>{Math.round(activeProgressPercent)}%</strong>
                    </div>
                    <div class="progress-track" aria-hidden="true">
                        <div
                            class="progress-fill"
                            style={`width: ${activeProgressPercent}%`}
                        ></div>
                    </div>
                </div>
            {/if}

            <div class="zone-actions">
                <label class="toggle">
                    <input type="checkbox" bind:checked={zone.enabled} />
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
