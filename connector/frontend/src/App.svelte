<script lang="ts">
  import logo from "./assets/images/logo-universal.png";
  import { OpenFolderSelectWindow } from "../wailsjs/go/main/App.js";
  import { GetNewestFileName } from "../wailsjs/go/main/App.js";
  import { SetFileName } from "../wailsjs/go/main/App.js";
  import { WatchFile } from "../wailsjs/go/main/App.js";
  import { ResetOffset } from "../wailsjs/go/main/App.js";
  import { UpdateSetting } from "../wailsjs/go/main/App.js";
  import { LoadSetting } from "../wailsjs/go/main/App.js";

  import { onMount } from "svelte";
  import Header from "./Header.svelte";
  import Content from "./Content.svelte";
  import Tabs from "./Tabs.svelte";
  import Footer from "./Footer.svelte";

  import { main } from "../wailsjs/go/models";

  // let logFilePath: string = "";
  let logFileName: string = "";
  let intervalId = 0;
  let saveData: main.SaveData;

  let contents: main.Setting[] = [];
  let selectedContent: main.Setting | null = null;
  let logs: string[] = [];
  let idCount = 0;

  window.runtime.EventsOn("commonLogOutput", (eventString) => {
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} NOTICE: ${eventString}`,
    ];
  });
  window.runtime.EventsOn("pushHttpEvent", (eventString) => {
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} POST HTTP REQUEST: ${eventString}`,
    ];
  });

  init();
  async function init() {
    await LoadSetting().then((result) => (saveData = result));
    contents = saveData.settings;
    if (intervalId != 0) {
      clearInterval(intervalId);
    }
    await getLogFiles();
    intervalId = setInterval(getLogFiles, 1 * 60 * 1000);
    WatchFile().then((result) => console.log(result));
  }

  async function getLogFolderPath() {
    await OpenFolderSelectWindow().then((result) => (saveData.path = result));
    console.log(saveData.path);
    await getLogFiles();
  }

  async function getLogFiles() {
    if (saveData.path == undefined || saveData.path == "") {
      return;
    }
    // ログフォルダ内のファイルを取得する
    const tempFileName = logFileName;
    await GetNewestFileName(saveData.path).then(
      (result) => (logFileName = result),
    );
    if (tempFileName != logFileName) {
      await ResetOffset().then();
    }
    // 本当は↑に入れたいがなぜかログファイルが更新されないことがあるので
    await SetFileName(logFileName).then((result) => console.log(result));
  }

  async function addContent() {
    // uuid作成
    const uuid = () =>
      Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    const newContent: main.Setting = {
      id: uuid(),
      title: `untitled ${idCount++}`,
      target: "",
      details: "",
      type: "Web Request",
      url: "",
      regexp: "",
      // trim2: "",
    };
    contents = [...contents, newContent];
    // 選択を更新
    selectedContent = contents.find((content) => content.id === newContent.id);
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} addContent: ${newContent.id} ${newContent.title}`,
    ];
    await UpdateSetting(contents).then((result) => console.log(result));
  }

  function selectContent(customEvent: CustomEvent<main.Setting>) {
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
  async function updateContent(customEvent: CustomEvent<main.Setting>) {
    // CustomEvent<any> を Content型に変換
    let updateContent = customEvent.detail;
    contents = contents.map((content) =>
      content.id === updateContent.id ? updateContent : content,
    );
    logs = [
      ...logs,
      `${new Date().toLocaleTimeString()} updateContent: ${updateContent.id} ${updateContent.title}`,
    ];
    await UpdateSetting(contents).then((result) => console.log(result));
  }

  async function deleteContent(customEvent: CustomEvent<main.Setting>) {
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
    await UpdateSetting(contents).then((result) => console.log(result));
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
