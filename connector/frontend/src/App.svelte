<script lang="ts">
  import logo from "./assets/images/logo-universal.png";
  import { OpenFolderSelectWindow } from "../wailsjs/go/main/App.js";
  import { GetNewestFileName } from "../wailsjs/go/main/App.js";
  import { SetFileName } from "../wailsjs/go/main/App.js";
  import { WatchFile } from "../wailsjs/go/main/App.js";
  import { ResetOffset } from "../wailsjs/go/main/App.js";
  import { OutputLog } from "../wailsjs/go/main/App.js";
  import { LoadSetting } from "../wailsjs/go/main/App.js";

  let logFilePath: string;
  let logFileName: string;
  let intervalId = 0;
  let debugText = "";

  // worldID用のリスト
  let worldID: string = "";
  let userID = "dummy";

  // worldIDListに追加
  window.runtime.EventsOn("setWorldID", (id) => {
    OutputLog("setWorldID:" + id);
    worldID = id;
    // TODO: Svelteで配列にPushしたやつを反映させるやり方
  });
  window.runtime.EventsOn("setUserID", (id) => {
    OutputLog("setUserID:" + id);
    userID = id;
  });

  async function init() {
    OutputLog("App.svelte: init()");
    await LoadSetting().then((result) => (logFilePath = result));
    // json設定ファイルを読み込んで各コンポーネントに展開する
    if (intervalId != 0) {
      clearInterval(intervalId);
    }
    await getLogFiles();
    intervalId = setInterval(getLogFiles, 5 * 60 * 1000);
    WatchFile().then((result) => console.log(result));
  }

  init();

  async function getLogFolderPath() {
    await OpenFolderSelectWindow().then((result) => (logFilePath = result));
    console.log(logFilePath);
    await getLogFiles();
  }

  async function getLogFiles() {
    if (logFilePath == undefined || logFilePath == "") {
      return;
    }
    // ログフォルダ内のファイルを取得する
    const tempFileName = logFileName;
    await GetNewestFileName(logFilePath).then(
      (result) => (logFileName = result),
    );
    if (tempFileName != logFileName) {
      await ResetOffset().then();
    }
    // 本当は↑に入れたいがなぜかログファイルが更新されないことがあるので
    await SetFileName(logFileName).then((result) => console.log(result));
  }
</script>

<main>
  <br />
  <!-- <h3>ログフォルダの場所を入力してください</h3> -->
  <div class="input-box">
    <button class="btn" on:click={getLogFolderPath}>
      ログフォルダを指定
    </button>
    <div class="result">対象のフォルダ: {logFilePath}</div>
    <div class="result">現在の監視対象: {logFileName}</div>
  </div>
  <br />
  <p>あなたのユーザーID: {userID}</p>
  <div class="result">
    {#if worldID != ""}
      Upload Visit Worlds ID
      <p>{worldID}</p>
    {/if}
  </div>
</main>

<style>
  #random-photo {
    width: 600px;
    height: auto;
  }

  #breed-photos {
    width: 300px;
    height: auto;
  }

  .btn:focus {
    border-width: 3px;
  }

  #logo {
    display: block;
    width: 50%;
    height: 50%;
    margin: auto;
    padding: 10% 0 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 100% 100%;
    background-origin: content-box;
  }

  .result {
    height: 20px;
    line-height: 20px;
    margin: 1.5rem auto;
  }

  .input-box .btn {
    height: 30px;
    line-height: 30px;
    border-radius: 3px;
    border: none;
    margin: 0 0 0 20px;
    padding: 0 8px;
    cursor: pointer;
  }

  .input-box .btn:hover {
    background-image: linear-gradient(to top, #cfd9df 0%, #e2ebf0 100%);
    color: #333333;
  }

  .input-box .input {
    border: none;
    border-radius: 3px;
    outline: none;
    height: 30px;
    line-height: 30px;
    padding: 0 10px;
    background-color: rgba(240, 240, 240, 1);
    -webkit-font-smoothing: antialiased;
  }

  .input-box .input:hover {
    border: none;
    background-color: rgba(255, 255, 255, 1);
  }

  .input-box .input:focus {
    border: none;
    background-color: rgba(255, 255, 255, 1);
  }
</style>
