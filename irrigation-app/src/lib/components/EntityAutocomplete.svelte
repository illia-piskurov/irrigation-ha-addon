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
    let inputElement = $state<HTMLInputElement | null>(null);
    let dropdownStyle = $state("");

    $effect(() => {
        if (!isOpen) {
            return;
        }

        updateDropdownPosition();

        const handleViewportChange = () => {
            updateDropdownPosition();
        };

        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);

        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    });

    function openAutocomplete() {
        if (blurTimer) {
            clearTimeout(blurTimer);
        }

        isOpen = true;
        updateDropdownPosition();
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

    function updateDropdownPosition() {
        if (!inputElement) {
            return;
        }

        const rect = inputElement.getBoundingClientRect();
        const viewportPadding = 8;
        const preferredWidth = Math.max(rect.width, 260);
        const maxAllowedWidth = Math.max(
            260,
            window.innerWidth - viewportPadding * 2,
        );
        const width = Math.min(preferredWidth, maxAllowedWidth);
        const left = Math.max(
            viewportPadding,
            Math.min(rect.left, window.innerWidth - width - viewportPadding),
        );
        const top = rect.bottom + 6;

        dropdownStyle = `position: fixed; top: ${top}px; left: ${left}px; width: ${width}px;`;
    }
</script>

<div class="entity-autocomplete">
    <small class="entity-source">Источник: {source}</small>
    <input
        bind:this={inputElement}
        type="text"
        value={getDisplayValue()}
        {placeholder}
        onfocus={openAutocomplete}
        onblur={closeAutocompleteDeferred}
        oninput={(event) => {
            onValueChange((event.currentTarget as HTMLInputElement).value);
            updateDropdownPosition();
        }}
    />
    <small class="entity-id-value">ID: {entityId || "не выбран"}</small>

    {#if isOpen}
        {@const suggestions = getSuggestions()}
        {#if suggestions.length > 0}
            <div class="entity-suggestions" style={dropdownStyle}>
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
