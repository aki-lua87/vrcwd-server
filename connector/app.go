package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// backend url
// var backendURL string = "https://backend.jmnt34deg.workers.dev"

// var targetFileName string

// App struct
type App struct {
	ctx            context.Context
	targetFileName string
	SaveData       SaveData
}

type SaveData struct {
	LogPath  string    `json:"path"`
	Settings []Setting `json:"settings"`
}

type HttpRequestModel struct {
	Value string `json:"value"`
	Title string `json:"title"`
}

type XSOverrayModel struct {
}

type LogOutputModel struct {
}

type Setting struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Details string `json:"details"`
	Target  string `json:"target"`
	Type    string `json:"type"`
	URL     string `json:"url"`
	RegExp  string `json:"regexp"`
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
	a.targetFileName = fileName
	// setIntervalごとにファイルの内容も確認
	a.ReadFile(a.SaveData.LogPath + "\\" + a.targetFileName)
}

func (a *App) LoadSetting() SaveData {
	log.Default().Println("[DEBUG] [LOG] LoadSetting")
	runtime.EventsEmit(a.ctx, "commonLogOutput", "LoadSetting")
	// 設定ファイルの読み込み
	file, err := os.ReadFile("setting.json")
	if err != nil {
		runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
		return SaveData{}
	}
	// JSONをStructに変換
	var saveData SaveData
	err = json.Unmarshal(file, &saveData)
	if err != nil {
		runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
	}
	log.Default().Println(saveData)
	runtime.EventsEmit(a.ctx, "commonLogOutput", "Target Log:"+saveData.LogPath)
	// a.SaveData.LogPath = saveData.LogPath
	a.SaveData = saveData
	return saveData
}

func (a *App) UpdateSetting(ss []Setting) {
	log.Default().Println("[DEBUG] [LOG] UpdateSetting:", len(ss))
	a.SaveData.Settings = ss
	// StructをJSONに変換
	jsonData, err := json.Marshal(a.SaveData)
	if err != nil {
		runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
	}
	runtime.EventsEmit(a.ctx, "commonLogOutput", string(jsonData))
	// JSONをファイルに書き込む
	err = os.WriteFile("setting.json", jsonData, 0644)
	if err != nil {
		runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
	}
	runtime.EventsEmit(a.ctx, "commonLogOutput", "Setting Updated Successfully")
}

func (a *App) OpenFolderSelectWindow() string {
	log.Default().Println("[DEBUG] [LOG] OpenFolderSelectWindow")
	// フォルダ選択ダイアログを開く
	// 選択されたフォルダのパスを返す
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select LogFile Folder",
	})
	if err != nil {
		runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
	}
	log.Default().Println("[DEBUG] [LOG] Target Path:" + path)
	// JSONに保存
	// saveData := SaveData{LogPath: path}
	a.SaveData.LogPath = path
	// StructをJSONに変換
	jsonData, err := json.Marshal(a.SaveData)
	if err != nil {
		log.Fatal(err)
	}
	// JSONをファイルに書き込む
	err = os.WriteFile("setting.json", jsonData, 0644)
	if err != nil {
		log.Fatal(err)
	}
	a.SaveData.LogPath = path
	return path
}

// フォルダ内の最新のtxtファイルを探索し、そのファイル名を返す
func (a *App) GetNewestFileName(path string) string {
	log.Default().Println("[DEBUG] [LOG] GetNewestFileName")
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
				runtime.EventsEmit(a.ctx, "commonLogOutput", "ERRPR:"+err.Error())
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
		a.targetFileName = newestFile.Name()
		return newestFile.Name()
	}
	return ""
}

// fsnotifyでの ファイルの監視を開始する
func (a *App) WatchFile() {
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
				fullpath := a.SaveData.LogPath + "\\" + a.targetFileName
				if event.Name == fullpath {
					a.ReadFile(fullpath)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("error:", err)
			}
		}
	}()

	err = watcher.Add(a.SaveData.LogPath)
	if err != nil {
		log.Fatal(err)
	}
	<-done
}

var lastOffset int64
var readFileName string

func (a *App) ResetOffset() {
	lastOffset = 0
}

func (a *App) ReadFile(path string) {
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
	log.Default().Println("[DEBUG] [LOG] newOffset: ", lastOffset)
}

// 行の評価
func (a *App) evaluateLine(line string) {
	// a.SaveData.Settings をループさせる
	for _, setting := range a.SaveData.Settings {
		if setting.RegExp != "" {
			pattern := regexp.MustCompile(setting.RegExp)
			matches := pattern.FindString(line)
			if matches != "" {
				a.OutputLog(setting.Title + " : " + matches)
				// setting.Type によって処理を分岐
				if setting.Type == "Web Request" {
					runtime.EventsEmit(a.ctx, "commonLogOutput", "Web Request:"+matches)
					message := a.HttpPost(matches, setting.Title, setting.URL)
					runtime.EventsEmit(a.ctx, "commonLogOutput", message)
				} else if setting.Type == "xs" {
					// a.XSOverray(matches)
				} else if setting.Type == "log" {
					// a.LogOutput(matches)
				}
			}
		}
	}

	// ユーザIDを取得
	// substr := "User Authenticated: "
	// if strings.Contains(line, substr) {
	// 	// substr と aaa の間の文字列を抽出する
	// 	userID := strings.Split(strings.Split(line, "(")[1], ")")[0]
	// 	log.Default().Println(userID)
	// 	a.userID = userID
	// 	runtime.EventsEmit(a.ctx, "setUserID", userID)
	// 	return
	// }
	// 訪れたワールドを取得
	// substr = "[Behaviour] Joining "
	// if strings.Contains(line, substr+"wrld_") {
	// 	// substr と aaa の間の文字列を抽出する
	// 	worldID := strings.Split(strings.Split(line, substr)[1], ":")[0]
	// 	log.Default().Println(worldID)
	// 	runtime.EventsEmit(a.ctx, "setWorldID", worldID)
	// 	a.PostWorldID(worldID)
	// 	return
	// }
	// 棋譜とかも、というか任意に取得したいよね
}

// func (a *App) PostWorldID(worldID string) string {
// 	// var data WorldHistory
// 	URL := backendURL + "/u/" + a.userID + "/w/histories"
// 	data := new(WorldHistory)
// 	data.WorldID = worldID
// 	data_json, _ := json.Marshal(data)
// 	res, err := http.Post(URL, "application/json", bytes.NewBuffer(data_json))
// 	if err != nil {
// 		log.Fatal(err)
// 	}
// 	defer res.Body.Close()
// 	body, err := io.ReadAll(res.Body)
// 	if err != nil {
// 		log.Fatal(err)
// 	}
// 	log.Default().Println(string(body))
// 	return "OK"
// }

func (a *App) HttpPost(eventString string, title string, url string) string {
	if url == "" {
		return "URL is empty"
	}
	// url形式じゃない場合の処理
	if !strings.HasPrefix(url, "http") {
		return "URL is invalid"
	}
	data := new(HttpRequestModel)
	data.Value = eventString
	data.Title = title
	data_json, _ := json.Marshal(data)
	res, err := http.Post(url, "application/json", bytes.NewBuffer(data_json))
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		log.Fatal(err)
	}
	log.Default().Println(string(body))
	return "OK"
}
