<script>
    export let logs;

    import { onMount, afterUpdate } from "svelte";

    let footerElement;

    // afterUpdateライフサイクルを使用してフッターが更新された後にスクロール
    afterUpdate(() => {
        footerElement.scrollTop = footerElement.scrollHeight;
    });
</script>

<footer bind:this={footerElement}>
    <ul>
        {#each logs as log}
            <li>{log}</li>
        {/each}
    </ul>
</footer>

<style>
    footer {
        padding: 1rem;
        background-color: #000000b3;
        height: 150px;
        overflow-y: auto;
        text-align: left; /* 左詰めに */
    }
    ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    li {
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
    }
</style>
