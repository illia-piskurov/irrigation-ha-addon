<script lang="ts">
    import { humanizeIdentifier } from "$lib";

    type EntityOption = {
        entityId: string;
        label: string;
    };

    type Props = {
        value: string;
        entityId: string;
        entityOptions: EntityOption[];
        source: string;
        placeholder?: string;
        onValueChange: (value: string) => void;
        onSelectEntityId: (entityId: string) => void;
    };

    let {
        value,
        entityId,
        entityOptions,
        source,
        placeholder = "Начните вводить имя или entity_id",
        onValueChange,
        onSelectEntityId,
    }: Props = $props();

    let isOpen = $state(false);
    let blurTimer: ReturnType<typeof setTimeout> | undefined;

    function openAutocomplete() {
        if (blurTimer) {
            clearTimeout(blurTimer);
        }

        isOpen = true;
    }

    function closeAutocompleteDeferred() {
        blurTimer = setTimeout(() => {
            isOpen = false;
        }, 120);
    }

    function selectSuggestion(selectedEntityId: string) {
        onSelectEntityId(selectedEntityId);
        isOpen = false;
    }

    function getSuggestions() {
        const query = (value || entityId).trim().toLowerCase();

        if (!query) {
            return entityOptions.slice(0, 8);
        }

        return entityOptions
            .filter(
                (entity) =>
                    entity.entityId.toLowerCase().includes(query) ||
                    entity.label.toLowerCase().includes(query),
            )
            .slice(0, 12);
    }

    function getDisplayValue() {
        return value || humanizeIdentifier(entityId);
    }
</script>

<div class="entity-autocomplete">
    <small class="entity-source">Источник: {source}</small>
    <input
        type="text"
        value={getDisplayValue()}
        {placeholder}
        onfocus={openAutocomplete}
        onblur={closeAutocompleteDeferred}
        oninput={(event) =>
            onValueChange((event.currentTarget as HTMLInputElement).value)}
    />
    <small class="entity-id-value">ID: {entityId || "не выбран"}</small>

    {#if isOpen}
        {@const suggestions = getSuggestions()}
        {#if suggestions.length > 0}
            <div class="entity-suggestions">
                {#each suggestions as suggestion}
                    <button
                        type="button"
                        class="entity-suggestion"
                        onmousedown={() =>
                            selectSuggestion(suggestion.entityId)}
                    >
                        <span>{suggestion.label}</span>
                        <small>{suggestion.entityId}</small>
                    </button>
                {/each}
            </div>
        {/if}
    {/if}
</div>
