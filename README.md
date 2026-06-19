# SwiftTranslate ⚡ — 極致快感的即時英翻中 & AI 特徵比對翻譯器

[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/daniel820421wang/SwiftTranslate)
[![Open in AI Studio](https://img.shields.io/badge/Google_AI_Studio-Build_&_Developer-8E44AD?style=for-the-badge&logo=google&logoColor=white)](https://ai.studio/build)
[![Live Demo Preview](https://img.shields.io/badge/Live_Demo-Open_Application-2ECC71?style=for-the-badge&logo=codeforces&logoColor=white)](https://ais-pre-topr4gj6vr6a2y6dkhjnbo-170806837407.asia-northeast1.run.app)
[![Dev Sandbox](https://img.shields.io/badge/Dev_Sandbox-Workspace_Mode-3498DB?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://ais-dev-topr4gj6vr6a2y6dkhjnbo-170806837407.asia-northeast1.run.app)

SwiftTranslate ⚡ 是一款專為跨國商務、線上學術演講、各國口音（如紐西蘭、澳洲、印度、英國、美國）傾力打造的**極致高精準度、自適應即時語音與手動比對英翻中翻譯平台**。

透過結合 **Google Web Speech API** 與 **Gemini 系列高階多模態 AI 模型**，本平台能在複雜的語意背景中實現「法醫級精準比對與翻譯（Taiwanese Mandarin localization）」。

---

## 🚀 隨開即玩即時連結 (One-Click Launch Links)

| 平台入口 | 連結與描述 |
| :--- | :--- |
| **🐙 GitHub 原始碼倉庫 (Git Repo)** | [🔗 點擊此處前往 GitHub 專案倉庫](https://github.com/daniel820421wang/SwiftTranslate) — 隨時線上開 code、下載 ZIP、Clone 或提交貢獻！ |
| **✨ 免設定即時體驗 (Live Demo)** | [🔗 點擊此處打開線上正式版](https://ais-pre-topr4gj6vr6a2y6dkhjnbo-170806837407.asia-northeast1.run.app) — 無需任何本地端配置，隨開即用！ |
| **🛠️ AI Studio 開發與編輯 (Dev Workspace)** | [🔗 點擊此處進入 AI Studio 雲端編輯器](https://ai.studio/build) — 探索、即時修改與部署本專案！ |
| **🧬 沙盒即時開發測試 (Sandbox)** | [🔗 點擊此處進入即時測試沙盒](https://ais-dev-topr4gj6vr6a2y6dkhjnbo-170806837407.asia-northeast1.run.app) — 實時看見最新 code 修改成果！ |

---

## 🎯 核心亮點功能特色

### 1. 🎙️ 雙軌輸入：AI 線上語音辨識 + 100% 穩定手動輸入門 (Hybrid Input)
* **自動語音轉錄**：支援一鍵開啟麥克風，實時將英文演講轉為逐字稿段落。
* **手動備援輸入門 (Fallback Portal)**：針對沙盒 iframe 權限受限或特定瀏覽器不支援 Web Speech API 的環境，提供精心設計的鍵盤/複製貼上文字框，讓段落特徵比對與翻譯能在 **100% 任何網路環境下完美自適應運行**。

### 2. 🧠 自適應語音歸納與更新 (Session Context Adaptive Updating)
* 系統可以一鍵提取當前對談/錄音中的所有英文歷史（如「紐西蘭經濟學、奇異鳥演化、日常小酒館」），並自動將其中英文主題歸納、更新至**大綱背景主題中**。下一次翻譯時，Gemini 便會自動契合精準的語境背景！

### 3. 🎯 多國預設口音與專屬背景特徵 (Preselected Dialogue Accent Tuning)
* 內建紐西蘭 (NZ)、澳大利亞 (AU)、印度 (IN)、英國 (UK) 與美國 (US) 等全球常見口音。
* 當選擇特定口音並填入大綱主題時，會觸發 Gemini **校正特定腔調的語音轉錄誤差與俚語譯法**。

### 4. ⚡ 閃電即時翻譯 + 一鍵貼心複製
* 每段語音或手動輸入送出後，系統秒級完成繁體中文（台灣標準慣用語）極致潤色翻譯。支援一鍵複製與歷史紀錄追蹤。

---

## 💻 本地端快速啟動指南 (Setup & Launching Locally)

如果您打算將專案下載或從 Git 複製到本地端開發，只需依循以下簡短步驟：

### 一、安裝相依性套件
```bash
npm install
```

### 二、選擇 AI 引擎並配置金鑰

本平台支援 **OpenAI、Claude、Gemini** 三種引擎，預設使用 **OpenAI**。

**A. 使用 OpenAI 或 Claude（推薦，免改檔案）**

無需建立 `.env`。啟動後直接在網頁右上角「**設定 → AI**」面板操作：
1. 在「API Provider」選擇 **OpenAI**（預設）或 **Claude**。
2. 填入對應的 API Key（OpenAI 為 `sk-...`、Claude 為 `sk-ant-...`）並選擇模型。

> 金鑰存於瀏覽器 localStorage，並透過本地 Vite proxy（`/api/openai`、`/api/anthropic`）轉發以避開 CORS。請勿將填入真實金鑰的狀態部署到公開環境。

**B. 使用 Gemini**

在專案根目錄建立 `.env` 檔案，填入 Gemini API 金鑰（從 https://aistudio.google.com/apikey 取得），並於設定面板將 Provider 切換為 **Gemini**：
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### 三、啟動開發伺服器
```bash
npm run dev
```
隨後打開瀏覽器訪問 `http://localhost:3000` 即可開始使用！

---
產品質感由 Google AI Studio Build 精心調校。歡迎點擊最上方的連結即刻在 GitHub 或 AI Studio 沙盒中開啟體驗！
