# OpenCode Panel

[English](README.md) · 繁體中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/SenCha930511/opencode-panel/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SenCha930511/opencode-panel)](https://github.com/SenCha930511/opencode-panel/releases)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/SenCha930511.opencode-panel?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=SenCha930511.opencode-panel)
[![GitHub stars](https://img.shields.io/github/stars/SenCha930511/opencode-panel?style=social)](https://github.com/SenCha930511/opencode-panel/stargazers)

一個 VS Code 側邊欄聊天擴充套件，透過官方 headless 伺服器驅動你**本機安裝的
[opencode](https://opencode.ai)**——不用離開編輯器，就有 Codex/Cursor 等級的
GUI 聊天面板。

## 功能

- **工作階段**——列表、建立、重新命名、刪除、搜尋、分享/取消分享、fork；
  工作階段狀態透過伺服器事件串流自動同步。面板採聊天優先：預設整個側邊欄
  都是對話介面，標題列的歷程按鈕會從左側滑出工作階段歷程抽屜（Esc、點擊
  遮罩或選取/建立工作階段皆會關閉）。側邊欄另有原生堆疊於「聊天」下方的
  「工作階段」檢視，獨立顯示工作階段清單，可由編輯器收合。
- **串流聊天**——Markdown 渲染、語法高亮、可收合的「思考中」(reasoning)
  片段，以及資料驅動的通用工具卡片（內建或自訂工具名都能正確顯示）。
- **輸入框**——Enter 送出、Shift+Enter 換行、每個工作階段各自的草稿、
  忙碌時可 Stop 中止；支援文字 + 圖片 + `@`-mention 檔案附加，遇到敏感路徑
  （`.env`、`*.pem`、`id_rsa`…）會在送出前警示。
- **斜線指令與選擇器**——輸入 `/` 開啟指令面板（內建與自訂指令都會出現），
  可依工作階段切換 agent 與模型。
- **審批卡片**——權限確認卡片（允許一次 / 永遠允許 / 拒絕）與問題卡片直接
  出現在對話中；絕不自動代答。
- **待辦與差異側欄**——工作階段的 todo 清單與逐訊息檔案差異，用 VS Code
  原生 diff 檢視。
- **訊息操作**——revert（需確認）、unrevert、重新產生、summarize/compact、
  執行 shell 指令、匯出逐字稿為 Markdown。
- **Token 用量列**——聊天工具列顯示此工作階段助理訊息的輸入/輸出/推理
  token 合計（伺服器回報用量前自動隱藏）。
- **IDE 整合**——編輯器右鍵「附加選取範圍 / 附加目前檔案」、檔案 chip 點擊
  即開、狀態列圖示含伺服器控制，以及**一鍵開啟 opencode TUI** 的出口。
- **MCP 面板**——顯示 opencode 原生設定的 MCP 伺服器。
- **能力偵測**——自動探測連接的伺服器，不支援的功能會隱藏並提示一次。
  無論有沒有裝 oh-my-opencode 都能正常運作。
- **雙語介面**（English / 繁體中文）——預設跟隨 VS Code 顯示語言，亦可用
  `opencodePanel.language` 明確指定語系，所有已開啟面板即時熱切換、不必重開。

### oh-my-opencode（OMO）補充說明

OMO 為**選配**。有安裝時：

- OMO 的**自訂 agents、指令與工具會自然出現並可用**——皆走標準伺服器 API，
  通用渲染、無特殊分支。
- **MCP 面板只列出原生設定的 MCP 伺服器**。OMO 插件可能注入額外的 MCP
  伺服器，這些不一定會出現在清單中——面板內會顯示這則提醒。

未安裝 OMO 時，除上述提醒外行為完全一致。

## 安裝方式

本擴充套件尚未上架 Marketplace，請安裝打包好的 `.vsix`：

1. 從 [Releases](https://github.com/SenCha930511/opencode-panel/releases)
   取得最新的 `opencode-panel-x.y.z.vsix`，或依下節說明自行建置。
2. 在「擴充功能」檢視中，從 `...` 選單選擇**「從 VSIX 安裝...」**並選取該
   檔案；或在終端機執行
   `code --install-extension opencode-panel-x.y.z.vsix`（使用你編輯器
   內建的 CLI）。
3. 依提示重新載入視窗，活動列就會出現面板圖示。

### 從原始碼建置

```bash
git clone https://github.com/SenCha930511/opencode-panel.git
cd opencode-panel
npm install
npm run build && npm run build:webview
npx vsce package   # 產生 opencode-panel-<version>.vsix
```

開發流程：執行 `npm run watch`（extension host）搭配
`npm run watch:webview`（webview），再按 **F5** 啟動 Extension
Development Host。

## 需求

- 已安裝 **opencode** 且在 `PATH` 中（或設定 `opencodePanel.binaryPath`）。
  安裝方式請以 [opencode 官方文件](https://opencode.ai/docs)為準，例如
  `curl -fsSL https://opencode.ai/install | bash`、
  `brew install anomalyco/tap/opencode` 或 `npm install -g opencode-ai`。
- opencode 內至少設定好一個 LLM provider（opencode 全權管理 provider 認證，
  本擴充套件絕不接觸你的金鑰）。
- **oh-my-opencode** 為選配（見上方說明）。
- VS Code **1.99.0** 或更新版本。

## 設定

所有設定皆位於 `opencodePanel.*` 命名空間——可在 VS Code 設定頁，或擴充
套件內建設定頁（聊天視窗右上齒輪）編輯。密碼只存放在 VS Code
SecretStorage。

| 設定 | 型別 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `opencodePanel.serverUrl` | string | `""` | 已啟動之 opencode 伺服器的完整 URL。設定後（且健康檢查通過）會直接 attach，不再自行 spawn。 |
| `opencodePanel.port` | number | `4096` | 受管理 `opencode serve` 使用的連接埠。 |
| `opencodePanel.hostname` | string | `"127.0.0.1"` | 受管理伺服器的 hostname。 |
| `opencodePanel.binaryPath` | string | `"opencode"` | 用來 spawn 與開啟 TUI 的 opencode 執行檔路徑或名稱。 |
| `opencodePanel.serverArgs` | string[] | `[]` | 傳給 `opencode serve` 的額外參數。 |
| `opencodePanel.autoStartServer` | boolean | `true` | 啟動時自動 spawn/attach 伺服器。 |
| `opencodePanel.minimumServerVersion` | string | `"0.0.0"` | 伺服器版本低於此門檻時警告（僅警告，不阻擋使用）。 |
| `opencodePanel.debugLogs` | boolean | `false` | 在 *OpenCode Panel* 輸出頻道輸出詳細記錄（憑證一律去識別化）。 |
| `opencodePanel.chatFontFamily` | string | `""` | 覆寫聊天字體（空白 = 沿用 VS Code 預設）。 |
| `opencodePanel.chatFontSize` | number | `0` | 覆寫聊天字體大小 px（0 = 沿用 VS Code 預設）。 |
| `opencodePanel.language` | enum | `"auto"` | 面板介面語言：`auto` 跟隨 VS Code 顯示語言；`en` / `zh-TW` 明確指定語系，即時套用到所有已開啟的面板。 |

## TUI 出口

狀態列選單或「Open opencode TUI」指令會開啟整合終端機，對面板伺服器執行
`opencode attach <server-url>`（舊版 CLI 則退回純 `opencode`）——完整的
終端介面永遠只差一個點擊。

## 已知限制

- **刻意不支援 attach 到你自己 TUI 的隨機連接埠**。面板只對每個工作區
  spawn 或 attach 一個已知的伺服器端點，不會去搜尋臨時 TUI 的 port。不過
  工作階段是共用的：同一台伺服器上，任何介面建立的工作階段都會出現在
  各處。
- MCP 面板只列出原生設定的 MCP 伺服器（見 OMO 說明）。
- 中文在地化僅提供繁體中文單一語系表；所有 `zh-*` 顯示語言變體皆回退至此表。
- 問題卡片只在連接的伺服器提供 question-reply 路由時出現（執行期偵測）。

## 螢幕截圖

> _截圖將隨第一個標記版本補上。_ 預留區塊：
>
> - 聊天視窗：串流回應與工具卡片
> - 權限確認卡片
> - 待辦與差異側欄、原生 diff 預覽
> - 設定頁
> - 英文介面一覽

## 貢獻

歡迎到
[SenCha930511/opencode-panel](https://github.com/SenCha930511/opencode-panel)
開 issue 或送 PR。送出前請確認品質關卡全數通過：`npm run build`、
`node scripts/check-i18n.mjs`、`node scripts/check-coverage.mjs` 與
`npm run test:unit`。

---

## License

[MIT](./LICENSE) © 2026 SenCha930511
