<script>
    import { createEventDispatcher } from "svelte";
    export let contents;
    const dispatch = createEventDispatcher();

    function handleSelectContent(content) {
        dispatch("selectContent", content);
    }

    function handleAddContent() {
        dispatch("addContent");
    }
</script>

<nav class="tabs">
    <button on:click={handleAddContent} class="add-button">+</button>
    {#each contents as content}
        <button on:click={() => handleSelectContent(content)}>
            {content.title || "Untitled"}
        </button>
    {/each}
</nav>

<style>
    .tabs {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.5rem;
        /* background-color: #1e0303; */
        overflow-y: auto;
        width: 200px;
    }
    button {
        padding: 0.5rem 1rem;
        font-size: 1rem;
        border: none;
        background-color: #007bff;
        color: white;
        border-radius: 4px;
        cursor: pointer;
    }
    button:hover {
        background-color: #0056b3;
    }
    .add-button {
        background-color: #28a745;
    }
    .add-button:hover {
        background-color: #218838;
    }
</style>
