import { useState, useEffect, type ReactNode } from "react";
import { useApp } from "../app/context.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";

const STORAGE_KEY = "opencode:omo:gui_state";

interface CustomAgentItem {
  id: string;
  name: string;
  model: string;
  mode: "primary" | "subagent";
  description: string;
  prompt: string;
}

interface OmoFormState {
  researchDepth: "deep" | "standard" | "fast";
  orchestrationMode: "hierarchical" | "sequential" | "parallel";
  autoVerify: boolean;
  agents: CustomAgentItem[];
}

const DEFAULT_STATE: OmoFormState = {
  researchDepth: "deep",
  orchestrationMode: "hierarchical",
  autoVerify: true,
  agents: [
    {
      id: "prompt-expert",
      name: "prompt-expert",
      model: "nchc/Kimi-K3",
      mode: "primary",
      description: "提示詞優化與角色設計專家",
      prompt: "你是一位專業的繁體中文提示詞工程專家，擅長優化各類 Agent 系統指令與角色人格設定。",
    },
    {
      id: "deep-researcher",
      name: "deep-researcher",
      model: "anthropic/claude-3-7-sonnet",
      mode: "subagent",
      description: "跨檔案全域深度程式碼探勘與架構分析",
      prompt: "專注於深入閱讀大型專案架構、追蹤資料流向並輸出精確分析報告。",
    },
  ],
};

function loadSavedState(): OmoFormState {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_STATE, ...parsed };
      }
    }
  } catch {}
  return DEFAULT_STATE;
}

export function OmoConfigTab(): ReactNode {
  const { init, pushToast } = useApp();
  const snapshot = useCapabilitySnapshot();
  const [form, setForm] = useState<OmoFormState>(loadSavedState);

  // New Agent Form state
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newMode, setNewMode] = useState<"primary" | "subagent">("primary");
  const [newDesc, setNewDesc] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasOmo = Boolean(init.capabilities.omo || init.capabilities.omoMcpNote);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      }
    } catch {}
  }, [form]);

  // Extract all available model IDs from snapshot
  const availableModels: string[] = [];
  if (snapshot?.providers) {
    for (const p of snapshot.providers) {
      for (const m of p.models) {
        availableModels.push(`${p.id}/${m.id}`);
      }
    }
  }

  // Generate AGENTS.md markdown content
  const generatedMarkdown = `# Oh-My-OpenCode Custom Agents

${form.agents
  .map(
    (a) => `## ${a.name}
- Description: ${a.description || a.name}
${a.model ? `- Model: ${a.model}\n` : ""}- Mode: ${a.mode}
- Prompt:
  ${a.prompt.split("\n").join("\n  ")}
`,
  )
  .join("\n")}`;

  const handleAddAgent = () => {
    if (!newName.trim()) {
      pushToast("warning", "請輸入智慧體名稱！");
      return;
    }
    const agentName = newName.trim();
    if (form.agents.some((a) => a.name.toLowerCase() === agentName.toLowerCase())) {
      pushToast("warning", `智慧體「${agentName}」已存在！`);
      return;
    }

    const newAgent: CustomAgentItem = {
      id: agentName,
      name: agentName,
      model: newModel.trim(),
      mode: newMode,
      description: newDesc.trim(),
      prompt: newPrompt.trim(),
    };

    setForm((prev) => ({
      ...prev,
      agents: [...prev.agents, newAgent],
    }));

    // Reset inputs
    setNewName("");
    setNewModel("");
    setNewDesc("");
    setNewPrompt("");
    setShowAddModal(false);
    pushToast("info", `已成功新增智慧體「${agentName}」！`);
  };

  const handleRemoveAgent = (idToRemove: string) => {
    setForm((prev) => ({
      ...prev,
      agents: prev.agents.filter((a) => a.id !== idToRemove),
    }));
    pushToast("info", "已刪除智慧體");
  };

  const onCopyMarkdown = () => {
    void navigator.clipboard.writeText(generatedMarkdown).then(() => {
      setCopied(true);
      pushToast("info", "已複製 AGENTS.md 內容到剪貼簿！");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 1. OMO Global Preferences Card */}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-info/15 text-info text-xs font-bold">
              ⚡
            </span>
            <h3 className="text-xs font-semibold text-fg">OMO 全域調度與偏好</h3>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              hasOmo ? "border border-ok/30 bg-ok/15 text-ok" : "border border-card-border/60 bg-card-bg/60 text-muted-fg"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${hasOmo ? "bg-ok" : "bg-off"}`} />
            <span>{hasOmo ? "OMO 已啟用" : "未偵測到 OMO 外掛"}</span>
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {/* Research Depth */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-xs font-medium text-fg/90">研究探勘深度 (Research Depth)</label>
              <p className="text-[11px] text-muted-fg leading-tight">控制 Deep Research 管線探索檔案與關聯程式碼的層級</p>
            </div>
            <div className="w-full sm:w-64">
              <select
                value={form.researchDepth}
                onChange={(e) => setForm({ ...form, researchDepth: e.target.value as any })}
                className="w-full rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
              >
                <option value="deep">deep (深度探勘 — 跨檔案全域分析)</option>
                <option value="standard">standard (標準 — 關聯檔案分析)</option>
                <option value="fast">fast (快速 — 僅當前檔案與直接參照)</option>
              </select>
            </div>
          </div>

          {/* Orchestration Mode */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-t border-card-border/30 pt-2.5">
            <div>
              <label className="text-xs font-medium text-fg/90">多智慧體協同架構 (Orchestration)</label>
              <p className="text-[11px] text-muted-fg leading-tight">決定主力智慧體與次級智慧體之間的調度溝通模式</p>
            </div>
            <div className="w-full sm:w-64">
              <select
                value={form.orchestrationMode}
                onChange={(e) => setForm({ ...form, orchestrationMode: e.target.value as any })}
                className="w-full rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
              >
                <option value="hierarchical">hierarchical (主從階層式調度)</option>
                <option value="sequential">sequential (循序流水線式協同)</option>
                <option value="parallel">parallel (平行分工執行)</option>
              </select>
            </div>
          </div>

          {/* Auto Verification */}
          <div className="flex items-center justify-between border-t border-card-border/30 pt-2.5">
            <div>
              <label className="text-xs font-medium text-fg/90">自動代碼驗證 (Auto Verification / QA)</label>
              <p className="text-[11px] text-muted-fg leading-tight">完成程式碼編輯後自動指派 QA 智慧體檢查語法與邏輯正確性</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoVerify}
                onChange={(e) => setForm({ ...form, autoVerify: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-card-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>
        </div>
      </section>

      {/* 2. Custom Agents Graphical Management Table */}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              👥
            </span>
            <h3 className="text-xs font-semibold text-fg">自訂智慧體與專屬模型綁定 (Custom Agents)</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(!showAddModal)}
            className="flex items-center gap-1 rounded-xl bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg shadow-2xs hover:bg-accent-hover active:scale-95 transition-all cursor-pointer"
          >
            <span>{showAddModal ? "取消" : "+ 新增智慧體"}</span>
          </button>
        </div>

        {/* Add Agent Expandable Form */}
        {showAddModal && (
          <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3.5 animate-in fade-in duration-150">
            <h4 className="text-xs font-semibold text-accent">建立新的自訂智慧體</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-fg">智慧體名稱 (Name)</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例: code-reviewer"
                  className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-fg">專屬綁定模型 (Pinned Model 🔒)</label>
                {availableModels.length > 0 ? (
                  <select
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
                  >
                    <option value="">（不綁定 — 允許自由自選模型）</option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        🔒 {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="例: nchc/Kimi-K3 (可留空)"
                    className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-fg">執行模式 (Mode)</label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as any)}
                  className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
                >
                  <option value="primary">primary (主力主要智慧體)</option>
                  <option value="subagent">subagent (次級委派智慧體)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-fg">簡短描述 (Description)</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="例: 專注於代碼品質與重構分析"
                  className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-fg">角色提示詞 (System Prompt)</label>
              <textarea
                rows={3}
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="輸入該 Agent 的 System Prompt 人格設定..."
                className="rounded-lg border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring resize-none font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg border border-card-border bg-card-bg/80 px-3 py-1 text-xs text-muted-fg hover:text-fg transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddAgent}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg shadow-2xs hover:bg-accent-hover cursor-pointer"
              >
                確認儲存智慧體
              </button>
            </div>
          </div>
        )}

        {/* Graphical Agents Table */}
        <div className="overflow-hidden rounded-xl border border-card-border/60 bg-card-bg/60">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-card-border/60 bg-panel-bg/60 text-[10px] font-semibold text-muted-fg uppercase tracking-wider">
                <th className="px-3 py-2">智慧體 (Name)</th>
                <th className="px-3 py-2">綁定模型 (Model)</th>
                <th className="px-3 py-2">模式 (Mode)</th>
                <th className="px-3 py-2">描述 (Description)</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/30">
              {form.agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-hover-bg/40 transition-colors">
                  <td className="px-3 py-2 font-semibold text-fg">
                    <span className="font-mono">{agent.name}</span>
                  </td>
                  <td className="px-3 py-2">
                    {agent.model ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-mono font-medium text-amber-400">
                        <span>🔒</span>
                        <span>{agent.model}</span>
                      </span>
                    ) : (
                      <span className="text-muted-fg/60">自由選取</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-panel-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-fg">
                      {agent.mode}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-fg text-[11px] max-w-xs truncate" title={agent.description}>
                    {agent.description || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveAgent(agent.id)}
                      className="rounded p-1 text-muted-fg hover:bg-err/15 hover:text-err transition-colors cursor-pointer"
                      title="刪除此智慧體"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Live AGENTS.md Preview & Quick Copy */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-xs font-semibold text-fg/90 hover:text-fg cursor-pointer"
          >
            <span>{showPreview ? "▼" : "▶"}</span>
            <span>即時產出 AGENTS.md 設定檔檢視 (Live Markdown)</span>
          </button>
          <button
            type="button"
            onClick={onCopyMarkdown}
            className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg/80 px-2.5 py-1 text-[11px] font-medium text-fg shadow-2xs hover:bg-hover-bg transition-colors cursor-pointer"
          >
            <span>{copied ? "✓ 已複製 Markdown" : "複製 AGENTS.md"}</span>
          </button>
        </div>

        {showPreview && (
          <pre className="overflow-x-auto rounded-xl border border-card-border/60 bg-black/40 p-3 text-[11px] font-mono text-fg/90 leading-relaxed max-h-56">
            {generatedMarkdown}
          </pre>
        )}
      </section>
    </div>
  );
}
