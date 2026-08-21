import { useState, type ReactNode } from "react";
import { useApp } from "../app/context.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";

const DEFAULT_OPENCODE_JSON_TEMPLATE = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-3-7-sonnet",
  "agent": "build",
  "autoupdate": true,
  "permission": {
    "bash": "ask",
    "edit": "always"
  }
}`;

export function OpenCodeConfigTab(): ReactNode {
  const { pushToast } = useApp();
  const snapshot = useCapabilitySnapshot();
  const [copied, setCopied] = useState(false);

  const onCopyTemplate = () => {
    void navigator.clipboard.writeText(DEFAULT_OPENCODE_JSON_TEMPLATE).then(() => {
      setCopied(true);
      pushToast("info", "已複製 opencode.json 範本到剪貼簿！");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Overview & Path Reference Card */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ⚡
            </span>
            <h3 className="text-xs font-semibold text-fg">OpenCode 設定檔路徑</h3>
          </div>
          <span className="text-[11px] text-muted-fg font-mono">opencode.json</span>
        </div>

        <p className="text-xs text-muted-fg leading-relaxed">
          OpenCode 支援專案級與使用者全域層級的設定檔。專案目錄下的設定會自動優先於全域設定。
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
            <span className="text-[10px] font-semibold uppercase text-accent tracking-wider">專案設定檔 (Workspace)</span>
            <code className="text-[11px] font-mono text-fg break-all select-all">.opencode/opencode.json</code>
            <span className="text-[10px] text-muted-fg/80">僅對當前專案工作區生效</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
            <span className="text-[10px] font-semibold uppercase text-muted-fg tracking-wider">全域設定檔 (Global)</span>
            <code className="text-[11px] font-mono text-fg break-all select-all">~/.config/opencode/opencode.json</code>
            <span className="text-[10px] text-muted-fg/80">對所有專案通用的預設設定</span>
          </div>
        </div>
      </section>

      {/* Active Server Configuration Info */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-ok/15 text-ok text-xs font-bold">
              ✓
            </span>
            <h3 className="text-xs font-semibold text-fg">目前伺服器載入之設定</h3>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-xl border border-card-border/40 bg-panel-bg/40 px-3 py-2 text-xs">
            <span className="text-muted-fg">伺服器預設模型 (Default Model)</span>
            <span className="font-mono font-medium text-fg">{snapshot?.defaultModel ?? "（未指定，依 Provider 預設）"}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-card-border/40 bg-panel-bg/40 px-3 py-2 text-xs">
            <span className="text-muted-fg">已載入 Provider 數量</span>
            <span className="font-semibold text-fg">{snapshot?.providers.length ?? 0} 個</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-card-border/40 bg-panel-bg/40 px-3 py-2 text-xs">
            <span className="text-muted-fg">已註冊 Slash 指令數量</span>
            <span className="font-semibold text-fg">{snapshot?.commands.length ?? 0} 個</span>
          </div>
        </div>
      </section>

      {/* JSON Template Guide */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-amber-400/15 text-amber-400 text-xs font-bold">
              ⚙
            </span>
            <h3 className="text-xs font-semibold text-fg">標準 opencode.json 範本參考</h3>
          </div>
          <button
            type="button"
            onClick={onCopyTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg/80 px-2.5 py-1 text-[11px] font-medium text-fg shadow-2xs hover:bg-hover-bg transition-colors cursor-pointer"
          >
            <span>{copied ? "✓ 已複製" : "複製範本"}</span>
          </button>
        </div>

        <pre className="overflow-x-auto rounded-xl border border-card-border/60 bg-black/40 p-3 text-[11px] font-mono text-fg/90 leading-relaxed">
          {DEFAULT_OPENCODE_JSON_TEMPLATE}
        </pre>
      </section>
    </div>
  );
}
