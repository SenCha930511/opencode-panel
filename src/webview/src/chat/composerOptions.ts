/**
 * Composer advanced options: Reasoning Effort & Auto Mode settings.
 */

import { useSyncExternalStore } from "react";

export type EffortLevel = "low" | "medium" | "high" | "max";

const EFFORT_KEY = "opencode.composer.effort";
const AUTO_KEY = "opencode.composer.autoMode";

let currentEffort: EffortLevel = "high";
let currentAutoMode = false;

// Hydrate from localStorage if available
try {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const savedEffort = localStorage.getItem(EFFORT_KEY);
    if (savedEffort === "low" || savedEffort === "medium" || savedEffort === "high" || savedEffort === "max") {
      currentEffort = savedEffort;
    }
    const savedAuto = localStorage.getItem(AUTO_KEY);
    if (savedAuto !== null) {
      currentAutoMode = savedAuto === "true";
    }
  }
} catch {
  // Graceful fallback for SSR/node test environments
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeComposerOptions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEffort(): EffortLevel {
  return currentEffort;
}

const modelEffortCache = new Map<string, string>();

export function getModelEffort(modelId?: string, defaultEffort?: string): string {
  if (!modelId) return currentEffort;
  if (modelEffortCache.has(modelId)) {
    return modelEffortCache.get(modelId)!;
  }
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(`opencode.composer.effort.${modelId}`);
      if (saved) {
        modelEffortCache.set(modelId, saved);
        return saved;
      }
    }
  } catch {
    // Ignore
  }
  return defaultEffort ?? currentEffort;
}

export function setModelEffort(modelId: string, effortValue: string): void {
  modelEffortCache.set(modelId, effortValue);
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(`opencode.composer.effort.${modelId}`, effortValue);
      localStorage.setItem(EFFORT_KEY, effortValue);
    }
  } catch {
    // Ignore
  }
  if (effortValue === "low" || effortValue === "medium" || effortValue === "high" || effortValue === "max") {
    currentEffort = effortValue;
  }
  notify();
}

export function useModelEffort(modelId?: string, defaultEffort?: string): string {
  return useSyncExternalStore(
    subscribeComposerOptions,
    // i18n-allow-literal — subscription getters, not display copy
    () => getModelEffort(modelId, defaultEffort),
    () => getModelEffort(modelId, defaultEffort),
  );
}

export function setEffort(level: EffortLevel): void {
  if (currentEffort === level) return;
  currentEffort = level;
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(EFFORT_KEY, level);
    }
  } catch {
    // Ignore
  }
  notify();
}

export function useEffort(): EffortLevel {
  return useSyncExternalStore(subscribeComposerOptions, getEffort, getEffort);
}

export function getAutoMode(): boolean {
  return currentAutoMode;
}

const sessionAutoCache = new Map<string, boolean>();

export function getSessionAutoMode(sessionId?: string): boolean {
  if (sessionId && sessionAutoCache.has(sessionId)) {
    return sessionAutoCache.get(sessionId)!;
  }
  return currentAutoMode;
}

export function updateSessionAutoCache(sessionId: string, enabled: boolean): void {
  if (sessionAutoCache.get(sessionId) === enabled) return;
  sessionAutoCache.set(sessionId, enabled);
  notify();
}

export function setSessionAutoMode(sessionId: string | undefined, enabled: boolean): void {
  if (sessionId) {
    sessionAutoCache.set(sessionId, enabled);
  }
  setAutoMode(enabled);
  notify();
}

export function useSessionAutoMode(sessionId?: string): boolean {
  return useSyncExternalStore(
    subscribeComposerOptions,
    // i18n-allow-literal — subscription getters, not display copy
    () => getSessionAutoMode(sessionId),
    () => getSessionAutoMode(sessionId),
  );
}

export function setAutoMode(enabled: boolean): void {
  if (currentAutoMode === enabled) return;
  currentAutoMode = enabled;
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(AUTO_KEY, String(enabled));
    }
  } catch {
    // Ignore
  }
  notify();
}

export function useAutoMode(): boolean {
  return useSyncExternalStore(subscribeComposerOptions, getAutoMode, getAutoMode);
}
