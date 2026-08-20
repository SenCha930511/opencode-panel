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
