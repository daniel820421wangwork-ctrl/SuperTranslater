# SwiftTranslate ⚡ — Project Overview

> 快速上手文件，供 AI agent 接手時理解整個系統。

---

## 一、專案是什麼

**SwiftTranslate** 是一個純前端 SPA，核心功能是：

1. **即時語音轉文字**（英文輸入）
2. **即時中文翻譯**（AI 或瀏覽器內建）
3. **多裝置房間同步**（Firebase RTDB）— 一人說、多人看

主要使用場景：開會/上課時，有人說英文，旁邊的人用手機/電腦即時看到中文翻譯。

**部署位置**：GitHub Pages → `https://daniel820421wangwork-ctrl.github.io/SuperTranslater/`

---

## 二、技術棧

| 層級 | 技術 |
|------|------|
| 框架 | React 19 + TypeScript 5.8 + Vite 6 |
| 樣式 | Tailwind CSS 4（Vite plugin 模式） |
| 動畫 | motion/react（Framer Motion v12） |
| 圖示 | lucide-react |
| 語音辨識 | Web Speech API（即時）+ Silero VAD + in-browser Whisper |
| Whisper | `@huggingface/transformers` v3，跑在 Web Worker（WASM backend） |
| VAD | `@ricky0123/vad-web`（Silero VAD，偵測語音端點） |
| 翻譯 AI | Gemini / OpenAI / Claude（直接從瀏覽器呼叫 API，無後端） |
| 翻譯瀏覽器內建 | Chrome Translator API（`window.Translator`，en→zh-Hant） |
| 多裝置同步 | Firebase Realtime Database（RTDB） |
| PWA | `manifest.json` + Apple meta tags，可加入手機主畫面 |

---

## 三、檔案結構

```
SuperTranslater/
├── src/
│   ├── App.tsx              # 主元件（全部 UI 和業務邏輯，~2300 行）
│   ├── ErrorBoundary.tsx    # React Error Boundary（顯示 crash 原因，方便手機 debug）
│   ├── main.tsx             # 入口：<AppErrorBoundary><App /></AppErrorBoundary>
│   ├── roomSync.ts          # Firebase RTDB 操作封裝（房間、成員、segments、live transcript）
│   ├── browserTranslate.ts  # Chrome 內建翻譯 API 封裝
│   ├── whisperWorker.ts     # Web Worker：Whisper WASM 推論，serialized queue
│   ├── firebaseConfig.ts    # Firebase config 的 load/save/parse（存在 localStorage）
│   ├── index.css            # Tailwind directives + custom-scrollbar 樣式
│   └── lib/utils.ts         # cn() helper（clsx + tailwind-merge）
├── public/
│   ├── manifest.json        # PWA manifest（相對路徑！base 是 /SuperTranslater/）
│   ├── icon-192.png         # PWA 圖示（翻譯主題：兩個對話框 A/中）
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   └── favicon-32.png
├── index.html               # PWA meta tags，相對 href（不能加 /SuperTranslater/ 前綴）
├── vite.config.ts           # base: '/SuperTranslater/'（build 用），dev 用 '/'
└── package.json
```

---

## 四、語音辨識三種模式

透過 `recognitionMode` state 切換，存在 `localStorage`。

### `live`（即時模式）
- 使用 Web Speech API
- 低延遲，邊說邊出文字
- 翻譯的也是這個 transcript

### `dual`（雙軌模式，預設）
- Web Speech API 產生「左側草稿」（`liveDraftTranscript`）—— 給使用者即時看，不送翻譯
- Whisper 產生「正式稿」—— 送翻譯、存檔，用於右側 timeline

### `whisper`（高精準模式）
- 只用 Silero VAD + Whisper，沒有 Web Speech
- 延遲最高（VAD pause 700ms + Whisper WASM 2–10s）但辨識最準，口音強也能辨識

---

## 五、Whisper 管線

```
麥克風 PCM
  → Silero VAD (vadRef, @ricky0123/vad-web)
      → onSpeechEnd: 擷取完整語音片段 (Float32Array)
          → resampleTo16k() 降至 16kHz mono
              → Web Worker (whisperWorker.ts)
                  → Whisper WASM pipeline ('Xenova/whisper-base', ~145MB)
                      → 回傳 transcript text
                          → cleanTranscript() 過濾雜訊標記
                          → isJunkTranscript() 丟棄幻覺輸出
                              → 送翻譯 → 加入 history
```

**重要細節：**
- Whisper Worker 一次只跑一個 job（`transcriptionQueue` 串接 Promise），不並行
- 下載是手動觸發的（`⬇ 下載 Whisper 模型` 按鈕），iOS 完全不下載
- iOS 判斷：`IS_IOS = iPhone|iPod regex || iPad regex || platform=MacIntel && maxTouchPoints>1`（後者覆蓋 iPadOS 13+）

---

## 六、翻譯管線

翻譯函數依 `effectiveTranslateMode`（`'ai'` or `'browser'`）呼叫不同路徑：

**AI 翻譯**（Gemini / OpenAI / Claude）
- API Key 存在 `localStorage`（`swift_transcript_ai_settings_v2`）
- Dev 環境走 Vite proxy（`/api/openai`, `/api/anthropic`），Production 直接呼叫 API（有 CORS 設定）
- System prompt 包含 `sessionContext`（使用者設定的場景說明）

**瀏覽器翻譯**
- `window.Translator`（Chrome Canary/Dev channel 實驗性功能）
- en → zh-Hant，完全離線，無需 API key
- `browserTranslate.ts` 封裝，singleton cache

---

## 七、多裝置房間同步（Firebase RTDB）

### Firebase 路徑結構
```
rooms/{roomId}/
  segments/{key}     # 每個已完成的翻譯段落（RoomSegment）
  members/{deviceId} # 在線成員 presence（onDisconnect 自動移除）
  commands/{deviceId}# 遠端指令（start/stop 收音）
  config/            # 房間設定（translateMode）
  live/{deviceId}    # 正在錄音中的即時草稿（LiveTranscript，停止時清除）
  clips/{key}        # 音訊 relay（手機上傳 → PC 轉錄）
```

### 主要 API（roomSync.ts）
- `pushSegment / updateSegment` — 推送/更新翻譯段落
- `joinPresence / leavePresence` — 進出房間（onDisconnect 自動清除）
- `setMemberRecording` — 通知其他人「我正在錄音」
- `sendCommand / subscribeCommand` — 遠端控制收音
- `setLiveTranscript / clearLiveTranscript` — 廣播即時草稿（150ms debounce）
- `subscribeLiveTranscripts` — 訂閱其他裝置的即時草稿

### Firebase 設定
Firebase config JSON 貼入設定介面，存在 `localStorage`（`swift_firebase_config`）。

---

## 八、UI 佈局

### 整體結構
```
<div min-h-screen flex-col lg:h-screen>
  <header fixed top-0 right-0 z-40 pointer-events-none>   ← 浮動，不擋底層點擊
    Logo + Menu button
    [Dropdown 選單]
  </header>

  <main flex-1 flex flex-col lg:flex-row overflow-hidden>
    <section>  ← 左側：逐字稿
    [drag divider]  ← 只在雙側都顯示時才出現
    <section>  ← 右側：翻譯 timeline
  </main>
</div>
```

### 左側（逐字稿）狀態切換
| 條件 | 顯示內容 |
|------|----------|
| `someoneRecording && voiceControls` | 連續逐字稿（自動捲動，`h-[45vh] lg:h-full`） |
| 其他 | 語音控制卡片 + 下方逐字稿 history（最高 35vh） |

「逐字稿 history」在兩種狀態都有 `data-seg-id` attribute，供右側點擊 highlight 使用。

### 右側（翻譯 timeline）
- `motion.div` 卡片，AnimatePresence 動畫進場
- 點擊 → `setHighlightedSegId(entry.id)` + `scrollIntoView({ behavior:'smooth', block:'nearest' })` → 2.5s 後清除 highlight
- 支援手動編輯翻譯文字（行內 `<textarea>`）
- `activeTab` 切換「翻譯紀錄」和「摘要」

### 拖曳分隔線
只在 `isWideLayout && voiceControls && timeline`（桌面、兩側都顯示）時渲染。
拖曳改變 `leftWidth` state（存 localStorage），最小 280px，最大 760px。

---

## 九、主要 State

```typescript
// 逐字稿 / 歷史
history            // {id, original, translated?, timestamp, deviceLabel?, deviceId?, translatedBy?}[]
interimTranscript  // Web Speech 即時草稿（未定稿）
liveDraftTranscript // dual 模式左側草稿

// 錄音
isRecording
recognitionMode    // 'dual' | 'live' | 'whisper'
whisperState       // 'idle' | 'loading' | 'ready' | 'error'

// AI 設定
aiSettings         // { provider, geminiModel, openaiModel, claudeModel, *Key }
translateMode      // 'ai' | 'browser'
effectiveTranslateMode // roomTranslateMode ?? translateMode

// 房間
roomId, roomMembers, roomConnected
roomLiveTranscripts // Record<deviceId, LiveTranscript>
highlightedSegId   // 當前被 highlight 的段落 id

// UI
visibleBlocks      // { voiceControls: boolean, timeline: boolean }
leftWidth          // 左側寬度 px
isWideLayout       // >= 1024px
transSizeIdx       // 中文字體大小 index
```

---

## 十、LocalStorage Keys

| Key | 用途 |
|-----|------|
| `swift_transcript_ai_settings_v2` | AI provider + model + keys |
| `swift_firebase_config` | Firebase JSON config |
| `swift_recognition_mode` | `'dual'` / `'live'` / `'whisper'` |
| `swift_visible_blocks` | `{ voiceControls, timeline }` |
| `swift_left_panel_width` | 拖曳後的寬度 px |
| `swift_trans_font_idx` | 中文字體大小 index |
| `swift_vad_threshold` | Silero VAD 靈敏度（0–1） |
| `swift_whisper_pause` | Whisper utterance pause ms |
| `swift_whisper_model` | Whisper model ID |
| `swift_translate_mode` | `'ai'` / `'browser'` |
| `swift_auto_switch_accent` | 是否自動偵測口音切換 locale |
| `swift_device_id` | 此裝置的 stable UUID |

---

## 十一、PWA / 部署

- **GitHub Pages** 部署在 `/SuperTranslater/` subpath
- `vite.config.ts`：`base: command === 'build' ? '/SuperTranslater/' : '/'`
- `manifest.json` 的 `start_url` 和 icon `src` 必須是**相對路徑**（`"."` 和 `"icon-192.png"`），不能有 `/` 前綴，否則 iOS PWA 啟動 404
- `index.html` 的 `<link href>` 也一樣：`href="manifest.json"` 而非 `/manifest.json`

---

## 十二、平台限制

### iOS（iPhone / iPad / iPadOS 13+）
- 不下載 Whisper WASM（記憶體不足且 Safari 限制）
- 改顯示警告：「請改用即時模式或在房間中讓桌機負責轉錄」
- Web Speech API 可正常用

### 手機通用
- 停止收音按鈕在 `pr-24` 偏移（避免被右上角浮動 header 遮住）
- 右側 timeline 在桌面加 `lg:pt-9`（避免被浮動 header 擋到），手機不需要

### Mac Safari
- 可使用 Whisper（不在 IS_IOS 判斷範圍內）

---

## 十三、錯誤處理

- **React Error Boundary**（`ErrorBoundary.tsx`）：任何 React render 崩潰都顯示 error message + component stack + reload 按鈕，而非白畫面
- **Toast 通知系統**：`toasts` state + `AnimatePresence`，顯示 3 秒後消失
- **Whisper junk 過濾**：`isJunkTranscript()` 丟棄 "thank you"、"you"、純符號等幻覺輸出

---

## 十四、效能瓶頸說明

右側翻譯結果延遲的完整路徑（`dual` / `whisper` 模式）：

```
VAD 偵測語音結束  ← 700ms pause（可調）
  + Whisper WASM 推論  ← 2–10 秒（主要瓶頸，依音訊長度）
    + AI 翻譯 API  ← 1–3 秒
      + 房間模式下 Firebase 寫 + 讀  ← 2–3 次 roundtrip
```

**Whisper jobs 是序列化的**（Worker 內部 `Promise.then` 串接），同時有多個語音段落時會排隊。

---

## 十五、Context Presets（場景記憶）

5 個預設場景（紐西蘭經濟學、軟體開發、商業談判、咖啡口語、技術客服），每個場景有對應的提示詞和關鍵字清單。`analyzeSessionMemory()` 根據已有的逐字稿關鍵字自動推薦最合適的場景。場景文字注入 AI 翻譯的 system prompt。

---

## 十六、GitHub Repo

```
https://github.com/daniel820421wangwork-ctrl/SuperTranslater
```

最近幾個重要 commits：
- `69c7745` — 逐字稿高度限制 + idle 狀態也顯示 history（跨面板 highlight 修正）
- `5568869` — 房間即時草稿共享；右側點擊左側 highlight
- `9ba2a48` — iOS 封鎖 Whisper；改為手動下載
- `8a99104` — React Error Boundary
- `3c79fd2` — 浮動 header、拖曳分隔線、選單點擊修正
