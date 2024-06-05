<script lang="ts">
  import logo from "./assets/images/logo-universal.png";
  import { OpenFolderSelectWindow } from "../wailsjs/go/main/App.js";
  import { GetNewestFileName } from "../wailsjs/go/main/App.js";
  import { SetFileName } from "../wailsjs/go/main/App.js";
  import { WatchFile } from "../wailsjs/go/main/App.js";
  import { ResetOffset } from "../wailsjs/go/main/App.js";
  import { OutputLog } from "../wailsjs/go/main/App.js";
  import { LoadSetting } from "../wailsjs/go/main/App.js";

  import { onMount } from "svelte";
  import Header from "./Header.svelte";
  import Content from "./Content.svelte";
  import Tabs from "./Tabs.svelte";
  import Footer from "./Footer.svelte";

  let logFilePath: string = "C:/Users/{username}/AppData/Local/VRChat/VRChat";
  let logFileName: string;
  let intervalId = 0;
  // let debugText = "";

  // worldID用のリスト
  let worldID: string = "";
  let userID = "dummy";

  // worldIDListに追加
  window.runtime.EventsOn("setWorldID", (id) => {
    worldID = id;
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} POST HTTP REQUEST: ${worldID}`,
    ];
  });
  window.runtime.EventsOn("setUserID", (id) => {
    // OutputLog("setUserID:" + id);
    userID = id;
  });

  async function init() {
    // OutputLog("App.svelte: init()");
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

  // content型の宣言
  interface ContentModel {
    id: number;
    title: string;
    target: string;
    details: string;
    type: string;
    url: string;
    trim1: string;
    trim2: string;
  }

  let contents: ContentModel[] = [];
  let selectedContent: ContentModel | null = null;
  let logs: string[] = [];
  let idCount = 0;

  function addContent() {
    idCount++;
    const newContent = {
      id: idCount,
      title: `設定 ${idCount}`,
      details: "",
      type: "Web Request",
      url: "",
      trim1: "",
      trim2: "",
    };
    contents = [...contents, newContent];
    // 選択を更新
    selectedContent = contents.find((content) => content.id === newContent.id);
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} addContent: ${newContent.id} ${newContent.title}`,
    ];
  }

  function selectContent(customEvent: CustomEvent<ContentModel>) {
    let selectContent = customEvent.detail;
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} selectContent: ${selectContent.id} ${selectContent.title}`,
    ];
    selectedContent = contents.find(
      (content) => content.id === selectContent.id,
    );
  }

  // CustomEvent<any>を使っているので、any型で受け取る
  function updateContent(customEvent: CustomEvent<ContentModel>) {
    // CustomEvent<any> を Content型に変換
    let updateContent = customEvent.detail;
    contents = contents.map((content) =>
      content.id === content.id ? content : updateContent,
    );
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} updateContent: ${updateContent.id} ${updateContent.title}`,
    ];
  }

  function deleteContent(customEvent: CustomEvent<ContentModel>) {
    let deleteContent = customEvent.detail;
    contents = contents.filter((content) => content.id !== deleteContent.id);
    if (contents.length > 0) {
      selectedContent = contents[0];
    } else {
      selectedContent = null;
    }
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} 削除しました: ${deleteContent.id} ${deleteContent.title}`,
    ];
  }

  function logEvent(customEvent: CustomEvent<string>) {
    let event = customEvent.detail;
    logs = [...logs, event];
  }
</script>

<main>
  <div class="container">
    <Header filename={logFileName} on:getLogFolderPath={getLogFolderPath} />
    <div class="main-content">
      <Tabs
        {contents}
        on:selectContent={selectContent}
        on:addContent={addContent}
      />
      {#if selectedContent}
        <Content
          bind:content={selectedContent}
          on:updateContent={updateContent}
          on:deleteContent={deleteContent}
          on:logEvent={logEvent}
        />
      {/if}
    </div>
    <Footer {logs} />
  </div>
</main>

<style>
  .container {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    flex-shrink: 0;
  }
  .main-content {
    display: flex;
    flex-grow: 1;
    overflow: hidden;
  }
  .content {
    flex-grow: 1;
    overflow-y: auto;
    padding: 1rem;
  }
  footer {
    flex-shrink: 0;
    text-align: left; /* フッターを左詰めに */
  }
</style>
