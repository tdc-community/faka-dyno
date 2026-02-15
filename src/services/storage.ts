import type { DynoData, PersistedState } from "../types";

export const STORAGE_KEYS = {
  state: "faka-dyno-state-v1",
  apiKey: "faka-dyno-api-key",
  imgbbApiKey: "faka-dyno-imgbb-api-key",
  uploadProvider: "faka-dyno-upload-provider",
  splashLastSeen: "faka-dyno-splash-last-seen",
} as const;

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function getStoredValue(key: string, fallback = ""): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) || fallback;
}

export function setStoredValue(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

export function getPersistedState(defaultData: DynoData): PersistedState {
  if (typeof window === "undefined") {
    return {
      data: defaultData,
      showHp: true,
      showTq: true,
    };
  }

  const raw = window.localStorage.getItem(STORAGE_KEYS.state);
  if (!raw) {
    return {
      data: defaultData,
      showHp: true,
      showTq: true,
    };
  }

  const parsed = safeParse(raw, {
    data: defaultData,
    showHp: true,
    showTq: true,
  });

  return {
    data: { ...defaultData, ...(parsed.data || {}) },
    showHp: typeof parsed.showHp === "boolean" ? parsed.showHp : true,
    showTq: typeof parsed.showTq === "boolean" ? parsed.showTq : true,
  };
}
