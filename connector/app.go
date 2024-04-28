package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var targetFileName string

// App struct
type App struct {
	ctx     context.Context
	teststr string
}

type SaveData struct {
	LogPath string `json:"path"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	runtime.LogInfo(ctx, "Application Startup called!")
}

func (a *App) OutputLog(logstring string) {
	log.Default().Println("[DEBUG] [LOG] OutputLog:" + logstring)
}

func (a *App) SetFileName(fileName string) {
	log.Default().Println("[DEBUG] [LOG] SetFileName:" + fileName)
	targetFileName = fileName
}

func (a *App) LoadSetting() string {
	log.Default().Println("[DEBUG] [LOG] LoadSetting")
	runtime.EventsEmit(a.ctx, "debug", "debug")
	// 設定ファイルの読み込み
	file, err := os.ReadFile("setting.json")
	if err != nil {
		log.Default().Println("[DEBUG] [LOG] LoadSetting ERR")
		return ""
	}
	// JSONをStructに変換
	var saveData SaveData
	err = json.Unmarshal(file, &saveData)
	if err != nil {
		log.Fatal(err)
	}
	log.Default().Println("[DEBUG] [LOG] LoadSetting Path:" + saveData.LogPath)
	return saveData.LogPath
}

// フォルダ内の最新のtxtファイルを探索し、そのファイル名を返す
func (a *App) SelectLatestLogFile(path string) string {
	log.Default().Println("[DEBUG] [LOG] SelectLatestLogFile")
	entries, err := os.ReadDir(path)
	if err != nil {
		log.Fatal(err)
	}
	var newestFile os.DirEntry
	var newestTime time.Time
	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				log.Fatal(err)
			}
			// 拡張子が.txtのファイルのみを対象とする
			if filepath.Ext(entry.Name()) != ".txt" {
				log.Default().Println("[DEBUG] [LOG] is not text: " + entry.Name())
				continue
			}
			if info.IsDir() || info.Size() == 0 {
				log.Default().Println("[DEBUG] [LOG] is Directory or empty: " + entry.Name())
				continue
			}
			if info.ModTime().After(newestTime) {
				// log.Default().Println("[DEBUG] [LOG] 最新のファイルに更新があります=> " + entry.Name() + info.ModTime().String())
				newestFile = entry
				newestTime = info.ModTime()
			}
		}
	}
	if newestFile != nil {
		return newestFile.Name()
	}
	return ""
}

func (a *App) OpenFolderSelectWindow() string {
	log.Default().Println("[DEBUG] [LOG] OpenFolderSelectWindow")
	// フォルダ選択ダイアログを開く
	// 選択されたフォルダのパスを返す
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select LogFile Folder",
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Default().Println("[DEBUG] [LOG] Target Path:" + path)
	// JSONに保存
	saveData := SaveData{LogPath: path}
	// StructをJSONに変換
	jsonData, err := json.Marshal(saveData)
	if err != nil {
		log.Fatal(err)
	}
	// JSONをファイルに書き込む
	err = os.WriteFile("setting.json", jsonData, 0644)
	if err != nil {
		log.Fatal(err)
	}
	return path
}

// fsnotifyでの ファイルの監視を開始する
func (a *App) WatchFile(folderpath string) {
	log.Default().Println("[DEBUG] [LOG] Start watching file")
	lastOffset = 0
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Fatal(err)
	}
	defer watcher.Close()

	done := make(chan bool)
	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				fullpath := folderpath + "\\" + targetFileName
				// log.Default().Println("[DEBUG] [LOG] watching file: " + fullpath)
				// log.Default().Println("[DEBUG] [LOG] [On Events]" + event.Name + event.Op.String())
				if event.Name == fullpath {
					a.readFile(fullpath)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("error:", err)
			}
		}
	}()

	err = watcher.Add(folderpath)
	if err != nil {
		log.Fatal(err)
	}
	<-done
}

var lastOffset int64

func (a *App) readFile(path string) {
	log.Default().Println("[DEBUG] [LOG] call readFile")
	log.Default().Println("[DEBUG] [LOG] lastOffset: ", lastOffset)
	file, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	// Seek to the last offset
	_, err = file.Seek(lastOffset, 0)
	if err != nil {
		log.Fatal(err)
	}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		a.evaluateLine(scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
	lastOffset, err = file.Seek(0, io.SeekCurrent)
	if err != nil {
		log.Fatal(err)
	}
}

// 行の評価
func (a *App) evaluateLine(line string) {
	// 訪れたワールドを取得
	substr := "[Behaviour] Joining "
	if strings.Contains(line, substr+"wrld_") {
		// substr と aaa の間の文字列を抽出する
		worldID := strings.Split(strings.Split(line, substr)[1], ":")[0]
		log.Default().Println(worldID)
		a.teststr = worldID
		runtime.EventsEmit(a.ctx, "debug", worldID)
	}
	// 棋譜とかも、というか任意に取得したいよね
}
