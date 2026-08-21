import { useState, type ReactNode } from "react";
import { useApp } from "../app/context.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";

const DEFAULT_AGENTS_MD_TEMPLATE = `# Custom Agents Configuration

## prompt-expert
- Description: 提示詞優化與角色設計專家
- Model: nchc/Kimi-K3
- Mode: primary
- Prompt:
  你是一位專業的繁體中文提示詞工程專家...
`;

export function OmoConfigTab(): ReactNode {
  const { init, pushToast } = useApp();
  const snapshot = useCapabilitySnapshot();
  const [copied, setCopied] = useState(false);

  const hasOmo = Boolean(init.capabilities.omo || init.capabilities.omoMcpNote);
  const agents = snapshot?.agents ?? [];

  const onCopyAgentsMd = () => {
    void navigator.clipboard.writeText(DEFAULT_AGENTS_MD_TEMPLATE).then(() => {
      setCopied(true);
      pushToast("info", "已複製 AGENTS.md 範本到剪貼簿！");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* OMO Status & Detection Header */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-info/15 text-info text-xs font-bold">
              ⚡
            </span>
            <h3 className="text-xs font-semibold text-fg">Oh-My-OpenCode (OMO) 狀態</h3>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              hasOmo ? "border border-ok/30 bg-ok/15 text-ok" : "border border-card-border/60 bg-card-bg/60 text-muted-fg"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${hasOmo ? "bg-ok" : "bg-off"}`} />
            <span>{hasOmo ? "已偵測並啟動 OMO" : "未偵測到 OMO 外掛"}</span>
          </span>
        </div>

        <p className="text-xs text-muted-fg leading-relaxed">
          Oh-My-OpenCode 為 OpenCode 提供了多智慧體調度（Multi-Agent System）、深度研究管線（Deep Research Pipeline）與自訂 Agent 支援。
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
            <span className="text-[10px] font-semibold uppercase text-accent tracking-wider">智慧體設定檔 (AGENTS.md)</span>
            <code className="text-[11px] font-mono text-fg break-all select-all">.opencode/AGENTS.md</code>
            <span className="text-[10px] text-muted-fg/80">專案自訂 Agent 人格與模型綁定</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
            <span className="text-[10px] font-semibold uppercase text-muted-fg tracking-wider">OMO 擴充目錄 (Agents Dir)</span>
            <code className="text-[11px] font-mono text-fg break-all select-all">.opencode/agents/*.json</code>
            <span className="text-[10px] text-muted-fg/80">各智慧體獨立設定檔</span>
          </div>
        </div>
      </section>

      {/* Agents & Model Lock Matrix */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              🤖
            </span>
            <h3 className="text-xs font-semibold text-fg">智慧體清單與模型綁定 (Agents Matrix)</h3>
          </div>
          <span className="text-[11px] text-muted-fg font-mono">{agents.length} 個智慧體</span>
        </div>

        {agents.length === 0 ? (
          <p className="text-xs text-muted-fg">尚未載入任何 Agent</p>
        ) : (
          <div className="flex flex-col gap-2">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5 text-xs transition-colors hover:bg-hover-bg/60"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-fg tracking-tight">{agent.name}</span>
                  <span className="rounded-md border border-card-border/40 bg-panel-bg/60 px-1.5 py-0.2 text-[10px] text-muted-fg">
                    {agent.builtIn ? "內建" : "自訂"}
                  </span>
                  {agent.mode && (
                    <span className="text-[10px] text-muted-fg/80 font-mono">[{agent.mode}]</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {agent.model ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-mono font-medium text-amber-400">
                      <span>🔒</span>
                      <span>{agent.model}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-fg/60">可自選模型</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AGENTS.md Template */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-amber-400/15 text-amber-400 text-xs font-bold">
              📝
            </span>
            <h3 className="text-xs font-semibold text-fg">AGENTS.md 範本參考</h3>
          </div>
          <button
            type="button"
            onClick={onCopyAgentsMd}
            className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg/80 px-2.5 py-1 text-[11px] font-medium text-fg shadow-2xs hover:bg-hover-bg transition-colors cursor-pointer"
          >
            <span>{copied ? "✓ 已複製" : "複製範本"}</span>
          </button>
        </div>

        <pre className="overflow-x-auto rounded-xl border border-card-border/60 bg-black/40 p-3 text-[11px] font-mono text-fg/90 leading-relaxed">
          {DEFAULT_AGENTS_MD_TEMPLATE}
        </pre>
      </section>
    </div>
  );
}
