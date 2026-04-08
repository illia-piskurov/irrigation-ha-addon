<script lang="ts">
    import { browser } from "$app/environment";
    import { base } from "$app/paths";
    import {
        formatHistoryPayload,
        formatHistoryTimestamp,
        getLevelLabel,
        getLevelText,
        getUserMessage,
        getVisibleEvents,
        summarizeDeveloperDetails,
        summarizePayload,
        type HistoryFilter,
        type ProgramEvent,
    } from "./history-utils";

    type Props = {
        programId: string;
        programName: string;
        buttonClass?: string;
        iconOnly?: boolean;
        zoneNameById?: Record<string, string>;
        zoneNameByEntityId?: Record<string, string>;
    };

    let {
        programId,
        programName,
        buttonClass = "ghost history-button",
        iconOnly = false,
        zoneNameById = {},
        zoneNameByEntityId = {},
    }: Props = $props();

    let isOpen = $state(false);
    let isLoading = $state(false);
    let loadError = $state("");
    let events = $state<ProgramEvent[]>([]);
    let activeFilter = $state<HistoryFilter>("all");
    let developerMode = $state(false);
    let dialogElement = $state<HTMLDialogElement | null>(null);

    function openDialog() {
        if (!dialogElement?.open) {
            dialogElement?.showModal();
        }
        isOpen = true;
        void loadHistory();
    }

    function closeDialog() {
        dialogElement?.close();
        isOpen = false;
    }

    function handleDialogClose() {
        isOpen = false;
    }

    function handleDialogClick(event: MouseEvent) {
        if (event.target === dialogElement) {
            closeDialog();
        }
    }

    function setFilter(filter: HistoryFilter) {
        activeFilter = filter;
    }

    async function loadHistory() {
        if (!browser || isLoading) {
            return;
        }

        isLoading = true;
        loadError = "";

        try {
            const response = await fetch(
                `${base}/api/history/${programId}?limit=50`,
            );
            if (!response.ok) {
                throw new Error(await response.text());
            }

            const payload = (await response.json()) as {
                events: ProgramEvent[];
            };
            events = payload.events ?? [];
        } catch (error) {
            loadError =
                error instanceof Error
                    ? error.message
                    : "Не удалось загрузить историю";
        } finally {
            isLoading = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            closeDialog();
        }
    }
</script>

<button type="button" class={buttonClass} onclick={openDialog}>
    {#if iconOnly}
        <span aria-hidden="true">🕘</span>
        <span class="visually-hidden">История</span>
    {:else}
        История
    {/if}
</button>

<dialog
    bind:this={dialogElement}
    class="history-dialog"
    aria-labelledby={`history-title-${programId}`}
    onclose={handleDialogClose}
    onclick={handleDialogClick}
>
    <div
        class="history-dialog-shell"
        role="dialog"
        tabindex="0"
        aria-modal="true"
        onkeydown={handleKeydown}
    >
        <div class="history-dialog-header">
            <div>
                <p class="history-dialog-eyebrow">История программы</p>
                <h3 id={`history-title-${programId}`}>{programName}</h3>
            </div>
            <div class="history-header-actions">
                <button
                    type="button"
                    class="ghost history-refresh"
                    onclick={() => void loadHistory()}
                    disabled={isLoading}
                >
                    {isLoading ? "Обновляем..." : "Обновить"}
                </button>
                <button
                    type="button"
                    class="ghost history-close"
                    onclick={closeDialog}
                >
                    Закрыть
                </button>
            </div>
        </div>

        <div class="history-dialog-body">
            {#if isLoading}
                <p class="history-state">Загружаем историю...</p>
            {:else if loadError}
                <p class="history-state history-error">{loadError}</p>
            {:else if events.length === 0}
                <p class="history-state">История пока пустая.</p>
            {:else}
                <div class="history-filters">
                    <button
                        type="button"
                        class={`ghost history-filter ${activeFilter === "all" ? "history-filter-active" : ""}`}
                        onclick={() => setFilter("all")}
                    >
                        Все
                    </button>
                    <button
                        type="button"
                        class={`ghost history-filter ${activeFilter === "errors" ? "history-filter-active" : ""}`}
                        onclick={() => setFilter("errors")}
                    >
                        Ошибки
                    </button>
                    <button
                        type="button"
                        class={`ghost history-filter ${activeFilter === "switch-success" ? "history-filter-active" : ""}`}
                        onclick={() => setFilter("switch-success")}
                    >
                        Успешные переключения
                    </button>
                    <button
                        type="button"
                        class={`ghost history-filter ${developerMode ? "history-filter-active" : ""}`}
                        onclick={() => (developerMode = !developerMode)}
                    >
                        {developerMode
                            ? "Режим разработчика: вкл"
                            : "Режим разработчика"}
                    </button>
                </div>

                {@const visibleEvents = getVisibleEvents(events, activeFilter)}

                {#if visibleEvents.length === 0}
                    <p class="history-state">
                        По выбранному фильтру событий нет.
                    </p>
                {:else}
                    <div class="history-list">
                        {#each visibleEvents as event}
                            <article
                                class={`history-item history-item-${getLevelLabel(event.level)}`}
                            >
                                <div class="history-item-top">
                                    <div>
                                        <p class="history-item-time">
                                            {formatHistoryTimestamp(
                                                event.createdAt,
                                            )}
                                        </p>
                                        <p class="history-item-message">
                                            {getUserMessage(
                                                event,
                                                zoneNameById,
                                                zoneNameByEntityId,
                                            )}
                                        </p>
                                    </div>
                                    <span
                                        class={`status-chip status-${getLevelLabel(event.level)}`}
                                    >
                                        {getLevelText(event.level)}
                                    </span>
                                </div>

                                {#if summarizePayload(event)}
                                    <p class="history-item-summary">
                                        {summarizePayload(event)}
                                    </p>
                                {/if}

                                {#if developerMode && summarizeDeveloperDetails(event.payload, zoneNameById, zoneNameByEntityId)}
                                    <p class="history-item-summary">
                                        {summarizeDeveloperDetails(
                                            event.payload,
                                            zoneNameById,
                                            zoneNameByEntityId,
                                        )}
                                    </p>
                                {/if}

                                {#if developerMode && formatHistoryPayload(event.payload)}
                                    <pre
                                        class="history-payload">{formatHistoryPayload(
                                            event.payload,
                                        )}</pre>
                                {/if}
                            </article>
                        {/each}
                    </div>
                {/if}
            {/if}
        </div>
    </div>
</dialog>
