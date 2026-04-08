<script lang="ts">
    import { browser } from "$app/environment";
    import { base } from "$app/paths";

    type ProgramEvent = {
        id: string;
        programId: string | null;
        level: "info" | "warning" | "error";
        message: string;
        payload: unknown;
        createdAt: string;
    };

    type Props = {
        programId: string;
        programName: string;
        buttonClass?: string;
    };

    let {
        programId,
        programName,
        buttonClass = "ghost history-button",
    }: Props = $props();

    let isOpen = $state(false);
    let isLoading = $state(false);
    let loadError = $state("");
    let events = $state<ProgramEvent[]>([]);
    let activeFilter = $state<"all" | "errors" | "switch-success">("all");
    let developerMode = $state(false);

    function openDialog() {
        isOpen = true;
        void loadHistory();
    }

    function closeDialog() {
        isOpen = false;
    }

    function setFilter(filter: "all" | "errors" | "switch-success") {
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

    function formatTimestamp(value: string): string {
        return new Date(value).toLocaleString([], {
            dateStyle: "short",
            timeStyle: "medium",
        });
    }

    function formatPayload(payload: unknown): string {
        if (payload === null || payload === undefined) {
            return "";
        }

        if (typeof payload === "string") {
            return payload;
        }

        try {
            return JSON.stringify(payload, null, 2);
        } catch {
            return String(payload);
        }
    }

    function summarizePayload(payload: unknown): string {
        if (!payload || typeof payload !== "object") {
            return "";
        }

        const data = payload as Record<string, unknown>;
        const parts: string[] = [];

        if (typeof data.zoneId === "string") {
            parts.push(`Зона: ${data.zoneId}`);
        }

        if (typeof data.entityId === "string") {
            parts.push(`Сущность: ${data.entityId}`);
        }

        if (typeof data.state === "string") {
            parts.push(`Состояние: ${data.state}`);
        }

        if (typeof data.retryAt === "string") {
            parts.push(
                `Повтор: ${new Date(data.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
            );
        }

        if (typeof data.error === "string") {
            parts.push(`Ошибка: ${data.error}`);
        }

        return parts.join(" · ");
    }

    function getLevelLabel(level: ProgramEvent["level"]): string {
        if (level === "warning") {
            return "warning";
        }

        if (level === "error") {
            return "error";
        }

        return "info";
    }

    function isSwitchSuccessEvent(event: ProgramEvent): boolean {
        return (
            event.level === "info" &&
            (event.message === "Switch turned on" ||
                event.message === "Switch turned off")
        );
    }

    function getVisibleEvents(): ProgramEvent[] {
        if (activeFilter === "errors") {
            return events.filter((event) => event.level === "error");
        }

        if (activeFilter === "switch-success") {
            return events.filter(isSwitchSuccessEvent);
        }

        return events;
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            closeDialog();
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<button type="button" class={buttonClass} onclick={openDialog}>
    История
</button>

{#if isOpen}
    <div class="dialog-backdrop" role="presentation" onclick={closeDialog}>
        <div
            class="history-dialog"
            role="dialog"
            tabindex="0"
            aria-modal="true"
            aria-labelledby={`history-title-${programId}`}
            onclick={(event) => event.stopPropagation()}
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

                    {@const visibleEvents = getVisibleEvents()}

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
                                                {formatTimestamp(
                                                    event.createdAt,
                                                )}
                                            </p>
                                            <p class="history-item-message">
                                                {event.message}
                                            </p>
                                        </div>
                                        <span
                                            class={`status-chip status-${getLevelLabel(event.level)}`}
                                        >
                                            {event.level}
                                        </span>
                                    </div>

                                    {#if summarizePayload(event.payload)}
                                        <p class="history-item-summary">
                                            {summarizePayload(event.payload)}
                                        </p>
                                    {/if}

                                    {#if developerMode && formatPayload(event.payload)}
                                        <pre
                                            class="history-payload">{formatPayload(
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
    </div>
{/if}
