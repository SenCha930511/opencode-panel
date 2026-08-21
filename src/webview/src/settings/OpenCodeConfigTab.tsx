import { useState, useEffect, type ReactNode } from "react";
import { useApp } from "../app/context.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";

const STORAGE_KEY = "opencode:config:gui_state";

interface PermissionRule {
  tool: string;
  action: "always" | "ask" | "reject";
}

interface OpenCodeFormState {
  defaultModel: string;
  defaultAgent: string;
  autoUpdate: boolean;
  contextLimit: string;
  temperature: string;
  permissions: PermissionRule[];
}

const DEFAULT_STATE: OpenCodeFormState = {
  defaultModel: "anthropic/claude-3-7-sonnet",
  defaultAgent: "build",
  autoUpdate: true,
  contextLimit: "1048576",
  temperature: "0.2",
  permissions: [
    { tool: "bash", action: "ask" },
    { tool: "edit", action: "always" },
    { tool: "read", action: "always" },
    { tool: "mcp", action: "ask" },
  ],
};

function loadSavedState(): OpenCodeFormState {
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

export function OpenCodeConfigTab(): ReactNode {
  const { pushToast } = useApp();
  const snapshot = useCapabilitySnapshot();
  const [form, setForm] = useState<OpenCodeFormState>(loadSavedState);
  const [newTool, setNewTool] = useState("");
  const [newAction, setNewAction] = useState<"always" | "ask" | "reject">("ask");
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Extract available agents
  const availableAgents = snapshot?.agents.map((a) => a.name) ?? ["build", "plan", "general"];

  // Generate valid JSON config from GUI form
  const generatedJson = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: form.defaultModel,
      agent: form.defaultAgent,
      autoupdate: form.autoUpdate,
      ...(form.temperature ? { temperature: Number(form.temperature) } : {}),
      ...(form.contextLimit ? { limit: { context: Number(form.contextLimit) } } : {}),
      permission: form.permissions.reduce<Record<string, string>>((acc, rule) => {
        acc[rule.tool] = rule.action;
        return acc;
      }, {}),
    },
    null,
    2,
  );

  const handleAddPermission = () => {
    if (!newTool.trim()) return;
    const toolKey = newTool.trim().toLowerCase();
    if (form.permissions.some((p) => p.tool === toolKey)) {
      pushToast("warning", `權限規則「${toolKey}」已存在！`);
      return;
    }
    setForm((prev) => ({
      ...prev,
      permissions: [...prev.permissions, { tool: toolKey, action: newAction }],
    }));
    setNewTool("");
  };

  const handleRemovePermission = (toolToRemove: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.filter((p) => p.tool !== toolToRemove),
    }));
  };

  const handlePermissionChange = (tool: string, nextAction: "always" | "ask" | "reject") => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.map((p) => (p.tool === tool ? { ...p, action: nextAction } : p)),
    }));
  };

  const onCopyJson = () => {
    void navigator.clipboard.writeText(generatedJson).then(() => {
      setCopied(true);
      pushToast("info", "已複製產生的 opencode.json 設定到剪貼簿！");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Core Model & Agent Settings Card */}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              🤖
            </span>
            <h3 className="text-xs font-semibold text-fg">核心模型與智慧體偏好</h3>
          </div>
          <span className="text-[11px] text-muted-fg font-mono">opencode.json</span>
        </div>

        <div className="flex flex-col gap-3">
          {/* Default Model */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-xs font-medium text-fg/90">預設模型 (Default Model)</label>
              <p className="text-[11px] text-muted-fg leading-tight">全域發送提示詞時未指定模型所使用的預設模型</p>
            </div>
            <div className="w-full sm:w-64">
              {availableModels.length > 0 ? (
                <select
                  value={form.defaultModel}
                  onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                  className="w-full rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {!availableModels.includes(form.defaultModel) && (
                    <option value={form.defaultModel}>{form.defaultModel}</option>
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.defaultModel}
                  onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                  placeholder="provider/model-id"
                  className="w-full rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring"
                />
              )}
            </div>
          </div>

          {/* Default Agent */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-t border-card-border/30 pt-2.5">
            <div>
              <label className="text-xs font-medium text-fg/90">預設智慧體 (Default Agent)</label>
              <p className="text-[11px] text-muted-fg leading-tight">開啟新對話時預設指派的 Agent 角色</p>
            </div>
            <div className="w-full sm:w-64">
              <select
                value={form.defaultAgent}
                onChange={(e) => setForm({ ...form, defaultAgent: e.target.value })}
                className="w-full rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
              >
                {availableAgents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Auto Update Toggle */}
          <div className="flex items-center justify-between border-t border-card-border/30 pt-2.5">
            <div>
              <label className="text-xs font-medium text-fg/90">自動更新 (Auto Update)</label>
              <p className="text-[11px] text-muted-fg leading-tight">自動檢查並安裝 OpenCode CLI 與核心組件之更新</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoUpdate}
                onChange={(e) => setForm({ ...form, autoUpdate: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-card-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>
        </div>
      </section>

      {/* 2. Graphical Permissions Matrix Table Card */}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-ok/15 text-ok text-xs font-bold">
              🛡️
            </span>
            <h3 className="text-xs font-semibold text-fg">工具呼叫與執行權限矩陣 (Permissions)</h3>
          </div>
          <span className="text-[11px] text-muted-fg font-mono">{form.permissions.length} 項規則</span>
        </div>

        <p className="text-xs text-muted-fg leading-relaxed">
          設定模型呼叫終端指令、編輯檔案或執行外掛工具時的安全性批准政策。
        </p>

        {/* Graphical Permissions Table */}
        <div className="overflow-hidden rounded-xl border border-card-border/60 bg-card-bg/60">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-card-border/60 bg-panel-bg/60 text-[10px] font-semibold text-muted-fg uppercase tracking-wider">
                <th className="px-3 py-2">工具 / 功能名稱 (Tool)</th>
                <th className="px-3 py-2">批准策略 (Action)</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/30">
              {form.permissions.map((rule) => (
                <tr key={rule.tool} className="hover:bg-hover-bg/40 transition-colors">
                  <td className="px-3 py-2 font-mono font-medium text-fg flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    <span>{rule.tool}</span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={rule.action}
                      onChange={(e) => handlePermissionChange(rule.tool, e.target.value as any)}
                      className="rounded-lg border border-card-border/70 bg-input-card-bg px-2 py-1 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
                    >
                      <option value="always">always (一律允許自動執行)</option>
                      <option value="ask">ask (每次詢問確認)</option>
                      <option value="reject">reject (一律拒絕)</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemovePermission(rule.tool)}
                      className="rounded p-1 text-muted-fg hover:bg-err/15 hover:text-err transition-colors cursor-pointer"
                      title="刪除此規則"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add New Rule Row */}
        <div className="flex items-center gap-2 border-t border-card-border/40 pt-3">
          <input
            type="text"
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="自訂工具名稱 (例: web_search)"
            className="flex-1 rounded-xl border border-card-border bg-input-card-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-focus-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddPermission();
            }}
          />
          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as any)}
            className="rounded-xl border border-card-border bg-input-card-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-focus-ring cursor-pointer"
          >
            <option value="ask">ask (每次詢問)</option>
            <option value="always">always (一律允許)</option>
            <option value="reject">reject (一律拒絕)</option>
          </select>
          <button
            type="button"
            onClick={handleAddPermission}
            className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs hover:bg-accent-hover active:scale-95 transition-all cursor-pointer shrink-0"
          >
            + 新增規則
          </button>
        </div>
      </section>

      {/* 3. Advanced Parameters */}
      <section className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-info/15 text-info text-xs font-bold">
              ⚡
            </span>
            <h3 className="text-xs font-semibold text-fg">進階限制與參數</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg/90">上下文 Token 限制 (Context Limit)</label>
            <input
              type="number"
              value={form.contextLimit}
              onChange={(e) => setForm({ ...form, contextLimit: e.target.value })}
              placeholder="1048576"
              className="rounded-xl border border-card-border bg-input-card-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-focus-ring font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg/90">生成溫度 (Temperature 0.0 - 1.0)</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: e.target.value })}
              placeholder="0.2"
              className="rounded-xl border border-card-border bg-input-card-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-focus-ring font-mono"
            />
          </div>
        </div>
      </section>

      {/* 4. Live JSON Preview & Quick Copy */}
      <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-4 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowJsonPreview(!showJsonPreview)}
            className="flex items-center gap-2 text-xs font-semibold text-fg/90 hover:text-fg cursor-pointer"
          >
            <span>{showJsonPreview ? "▼" : "▶"}</span>
            <span>即時產出 JSON 檢視 (Live JSON)</span>
          </button>
          <button
            type="button"
            onClick={onCopyJson}
            className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg/80 px-2.5 py-1 text-[11px] font-medium text-fg shadow-2xs hover:bg-hover-bg transition-colors cursor-pointer"
          >
            <span>{copied ? "✓ 已複製 JSON" : "複製 opencode.json"}</span>
          </button>
        </div>

        {showJsonPreview && (
          <pre className="overflow-x-auto rounded-xl border border-card-border/60 bg-black/40 p-3 text-[11px] font-mono text-fg/90 leading-relaxed max-h-56">
            {generatedJson}
          </pre>
        )}
      </section>
    </div>
  );
}
