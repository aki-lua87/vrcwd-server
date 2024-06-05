<script>
    import { createEventDispatcher } from "svelte";
    export let content;
    const dispatch = createEventDispatcher();

    function updateContent(key, value) {
        content = { ...content, [key]: value };
        dispatch("updateContent", content);
        dispatch(
            "logEvent",
            `${new Date().toLocaleTimeString()} ${content.title} ${key} updated to ${value}`,
        );
    }

    function handleInput(event, key) {
        const target = event.target;
        updateContent(key, target.value);
    }

    function deleteContent() {
        dispatch("deleteContent", content);
        dispatch(
            "logEvent",
            `${new Date().toLocaleTimeString()} deleted: ${content.id} ${content.title}`,
        );
    }
</script>

<div class="content">
    <label class="text" for="Title">Title</label>
    <input
        id="Title"
        type="text"
        placeholder="Title"
        bind:value={content.title}
        on:change={(e) => handleInput(e, "title")}
    />
    <label class="text" for="Details">説明</label>
    <input
        id="Details"
        type="text"
        placeholder="Details"
        bind:value={content.details}
        on:change={(e) => handleInput(e, "details")}
    />
    <label class="text" for="Target">イベント起動文字列</label>
    <input
        id="Target"
        type="text"
        placeholder="Target"
        bind:value={content.target}
        on:change={(e) => handleInput(e, "target")}
    />
    <label class="text" for="Type">イベントタイプ</label>
    <select bind:value={content.type} on:change={(e) => handleInput(e, "type")}>
        <option value="Web Request">Web Request</option>
        <option value="Send XSOverray">Send XSOverray</option>
        <option value="Output Text">Output Text</option>
    </select>
    {#if content.type === "Web Request"}
        <label class="text" for="url-input">URL</label>
        <input
            type="text"
            placeholder="URL"
            bind:value={content.url}
            on:change={(e) => handleInput(e, "url")}
        />
    {/if}
    <div class="trim-fields">
        <div class="field">
            <label class="text" for="trim1-input">Trim 1</label>
            <input
                type="text"
                id="trim1-input"
                placeholder="Trim 1"
                bind:value={content.trim1}
                on:change={(e) => handleInput(e, "trim1")}
            />
            <!-- <input
                type="text"
                placeholder="Trim 1"
                bind:value={content.trim1}
                on:change={(e) => handleInput(e, "trim1")}
            /> -->
        </div>
        <div class="field">
            <label class="text" for="trim2-input">Trim 2</label>
            <input
                type="text"
                id="trim2-input"
                placeholder="Trim 2"
                bind:value={content.trim2}
                on:change={(e) => handleInput(e, "trim2")}
            />
        </div>
    </div>
    <button on:click={deleteContent} class="delete-button">DELETE</button>
</div>

<style>
    .content {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        background-color: #fff;
        border: 1px solid #ddd;
        border-radius: 4px;
        flex-grow: 1;
    }
    input,
    select {
        padding: 0.5rem;
        font-size: 1rem;
    }
    .delete-button {
        margin-top: 1rem;
        padding: 0.5rem;
        background-color: #ff4d4d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        /* ボタンデカさ */
        width: 7.5rem;
        /* ボタンを右詰めに */
        align-self: flex-end;
    }
    .delete-button:hover {
        background-color: #e60000;
    }
    /*文字色を変更*/
    .text {
        color: #000;
        font-weight: bold;
        /* 左詰めに */
        text-align: left;
    }
    .field {
        display: flex;
        flex-direction: column;
        /* gap: 0.25rem; */
    }
    .trim-fields {
        display: flex;
        /* justify-content: space-between; */
        gap: 0.5rem;
    }
</style>
