<script>
    import { createEventDispatcher } from "svelte";
    export let filename;
    const dispatch = createEventDispatcher();

    function handleButtonClick() {
        dispatch(
            "getLogFolderPath",
            `Header button clicked at ${new Date().toLocaleTimeString()}`,
        );
    }
</script>

<header>
    <p>監視ファイル名: {filename}</p>
    <button on:click={handleButtonClick}>フォルダを指定</button>
</header>

<style>
    header {
        display: flex;
        justify-content: space-between;
        align-items: right;
        /* 左側へパディングを追加 */
        padding: 0rem 1rem;
        /* padding: 0.5rem; */
        /* padding: 0rem; */
        /* background-color: #f5f5f5; */
    }
    /* ボタンは1行分の高さに */
    button {
        /* margin: 0 0.5rem; */
        padding: rem 1rem;
        /* ボタンの高さを1行分に */
        height: 2rem;
        /* ボタンの幅を1行分に */
        width: 10rem;
        /* 上下中央揃え */
        vertical-align: middle;
    }
</style>
