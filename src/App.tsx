import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import html2canvas from "html2canvas";
import { Check, Copy, Download, Eye, RotateCcw, Settings, Upload, X } from "lucide-react";
import logo from "./assets/logo.png";
import DynoGraph from "./components/DynoGraph";
import RpmGauge from "./components/RpmGauge";
import type {
  DynoData,
  MetricKey,
  PersistedState,
  RecentUpload,
  SliderItem,
  ToastState,
  UploadProvider,
} from "./types";

const SHOP_NAME = "FAKA PERFORMANCE";

const defaults: DynoData = {
  model: "Bravado Banshee 900R",
  engine: "V8 TT",
  plate: "FAKA-900R",
  drivetrain: "RWD",
  extTemp: "24 C",
  humidity: "52",
  correctionFactor: "1.02",
  operator: "A. Mercer",
  owner: "Franklin Clinton",
  mechanicNotes: "Проверен бууст контролер. Няма детонации при пълен товар.",
  whp: 0,
  wtq: 0,
  psi: 0,
  afr: 0,
  rpm: 0,
};

const sliderConfig: SliderItem[] = [
  { key: "whp", label: "Max HP", min: 0, max: 2200, step: 1 },
  { key: "wtq", label: "Max TQ", min: 0, max: 1200, step: 1 },
  { key: "psi", label: "Boost PSI", min: 0, max: 40, step: 0.1 },
  { key: "afr", label: "AFR", min: 0, max: 14, step: 0.1 },
  { key: "rpm", label: "Max RPM", min: 0, max: 12000, step: 50 },
];

const MECHANIC_NOTES_MAX_LENGTH = 1024;
const STORAGE_KEY = "faka-dyno-state-v1";
const API_KEY_STORAGE_KEY = "faka-dyno-api-key";
const IMGBB_API_KEY_STORAGE_KEY = "faka-dyno-imgbb-api-key";
const UPLOAD_PROVIDER_STORAGE_KEY = "faka-dyno-upload-provider";
const SPLASH_LAST_SEEN_KEY = "faka-dyno-splash-last-seen";
const RECENT_UPLOADS_STORAGE_KEY = "faka-dyno-recent-uploads";
const SPLASH_SKIP_WINDOW_MS = 4 * 60 * 60 * 1000;
const EXPORT_WIDTH = 1000;
const EXPORT_RENDER_SCALE = 2;
const MAX_RECENT_UPLOADS = 12;
const PRIMARY_API_BASE = "https://i.webproj.space/fapi";
const SEARCH_PAGE_SIZE = 7;

const UPLOAD_PROVIDERS: Record<UploadProvider, UploadProvider> = {
  primary: "primary",
  imgbb: "imgbb",
};

function toUploadProvider(value: string): UploadProvider {
  return value === UPLOAD_PROVIDERS.imgbb
    ? UPLOAD_PROVIDERS.imgbb
    : UPLOAD_PROVIDERS.primary;
}

const DECIMAL_METRICS = new Set<MetricKey>(["psi", "afr"]);

const METRIC_BOUNDS: Record<MetricKey, SliderItem> = sliderConfig.reduce(
  (acc, item) => {
    acc[item.key] = item;
    return acc;
  },
  {} as Record<MetricKey, SliderItem>,
);

const DEFAULT_STORAGE_STATE: PersistedState = {
  data: defaults,
  showHp: true,
  showTq: true,
};

function getStoredValue(key: string, fallback = ""): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) || fallback;
}

function setStoredValue(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecentUploads(): RecentUpload[] {
  const raw = getStoredValue(RECENT_UPLOADS_STORAGE_KEY, "[]");
  const parsed = safeParse<unknown[]>(raw, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item): RecentUpload | null => {
      if (typeof item === "string") {
        return { url: item, provider: "unknown", createdAt: Date.now(), fileName: "" };
      }
      if (!isRecord(item) || typeof item.url !== "string") {
        return null;
      }
      return {
        url: item.url,
        provider:
          item.provider === UPLOAD_PROVIDERS.primary || item.provider === UPLOAD_PROVIDERS.imgbb
            ? (item.provider as UploadProvider)
            : "unknown",
        createdAt: Number(item.createdAt) || Date.now(),
        fileName: typeof item.fileName === "string" ? item.fileName : "",
      };
    })
    .filter((item): item is RecentUpload => Boolean(item))
    .slice(0, MAX_RECENT_UPLOADS);
}

function mergeRecentUploads(existing: RecentUpload[], incoming: RecentUpload[]): RecentUpload[] {
  const merged = [...incoming, ...existing];
  const dedup: RecentUpload[] = [];
  const seen = new Set<string>();

  for (const item of merged) {
    if (!item || !item.url || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    dedup.push(item);
    if (dedup.length >= MAX_RECENT_UPLOADS) {
      break;
    }
  }

  return dedup;
}

function makeAbsoluteUrl(value: unknown): string {
  if (!value || typeof value !== "string") {
    return "";
  }

  const raw = value.trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw, `${PRIMARY_API_BASE}/`).href;
  } catch {
    return "";
  }
}

function deriveFileName(url: string, explicitName = ""): string {
  if (explicitName && typeof explicitName === "string") {
    return explicitName;
  }

  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    return segments.at(-1) || "";
  } catch {
    return "";
  }
}

function normalizeApiSearchResults(payload: unknown): RecentUpload[] {
  const source = isRecord(payload) ? payload : {};
  const sourceData = isRecord(source.data) ? source.data : {};
  const collections = [
    Array.isArray(payload) ? payload : null,
    Array.isArray(source.files) ? source.files : null,
    Array.isArray(source.items) ? source.items : null,
    Array.isArray(source.results) ? source.results : null,
    Array.isArray(source.data) ? source.data : null,
    Array.isArray(sourceData.files) ? sourceData.files : null,
    Array.isArray(sourceData.items) ? sourceData.items : null,
    Array.isArray(sourceData.results) ? sourceData.results : null,
  ].filter(Boolean);

  const flattened = collections.flat() as unknown[];
  const seen = new Set<string>();
  const mapped: RecentUpload[] = [];

  for (const item of flattened) {
    const entry = isRecord(item) ? item : null;
    const rawUrl =
      typeof item === "string"
        ? item
        : typeof entry?.url === "string"
          ? entry.url
          : typeof entry?.fileUrl === "string"
            ? entry.fileUrl
            : typeof entry?.imageUrl === "string"
              ? entry.imageUrl
              : typeof entry?.display_url === "string"
                ? entry.display_url
                : typeof entry?.path === "string"
                  ? entry.path
                  : typeof entry?.link === "string"
                    ? entry.link
                    : "";
    const url = makeAbsoluteUrl(rawUrl);
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    mapped.push({
      url,
      provider: UPLOAD_PROVIDERS.primary,
      createdAt:
        Number(entry?.createdAt) ||
        Number(entry?.uploadedAt) ||
        Number(entry?.timestamp) ||
        Date.now(),
      fileName: deriveFileName(
        url,
        typeof entry?.fileName === "string"
          ? entry.fileName
          : typeof entry?.filename === "string"
            ? entry.filename
            : typeof entry?.name === "string"
              ? entry.name
              : "",
      ),
    });

    if (mapped.length >= 200) {
      break;
    }
  }

  return mapped;
}

function formatRecentUploadTime(createdAt: number): string {
  const timestamp = Number(createdAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "-";
  }

  return new Date(timestamp).toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function withTrailingDot(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return ".";
  }

  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function extractUploadedUrl(result: unknown, provider: UploadProvider): string {
  if (!isRecord(result)) {
    return "";
  }

  if (provider === UPLOAD_PROVIDERS.imgbb) {
    const data = isRecord(result.data) ? result.data : {};
    return typeof data.url === "string"
      ? data.url
      : typeof data.display_url === "string"
        ? data.display_url
        : typeof data.url_viewer === "string"
          ? data.url_viewer
          : "";
  }

  return typeof result.url === "string" ? result.url : "";
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function getPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return DEFAULT_STORAGE_STATE;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STORAGE_STATE;
  }

  const parsed = safeParse(raw, DEFAULT_STORAGE_STATE);
  return {
    data: { ...defaults, ...(parsed.data || {}) },
    showHp: typeof parsed.showHp === "boolean" ? parsed.showHp : true,
    showTq: typeof parsed.showTq === "boolean" ? parsed.showTq : true,
  };
}

function sanitizeForFile(value: string): string {
  return (
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "na"
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildReportFileName(
  model: string,
  plate: string,
  unixTimestamp = Math.floor(Date.now() / 1000),
): string {
  const safeModel = sanitizeForFile(model);
  const safeRegNumber = sanitizeForFile(plate);
  return `faka-dyno-${safeModel}-${safeRegNumber}-${unixTimestamp}.png`;
}

async function waitForPreviewReady(previewElement: HTMLElement | null) {
  if (!previewElement) {
    return;
  }

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = Array.from(previewElement.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    images.map((img) => {
      if (img.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }),
  );

  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function isValidImageBlob(blob: Blob | null): blob is Blob {
  return Boolean(blob && blob.type === "image/png" && blob.size > 20000);
}

function isDecimalMetric(key: MetricKey): boolean {
  return DECIMAL_METRICS.has(key);
}

function isMetricKey(key: keyof DynoData): key is MetricKey {
  return key in METRIC_BOUNDS;
}

function normalizeMetricValue(key: MetricKey, value: number): number {
  return isDecimalMetric(key) ? Number(value.toFixed(1)) : Math.round(value);
}

function formatMetricValue(key: MetricKey, value: number): string {
  return isDecimalMetric(key) ? value.toFixed(1) : String(value);
}

function maskApiKey(value: string): string {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    const head = value.slice(0, 2);
    const tail = value.slice(-2);
    const stars = "*".repeat(Math.max(2, value.length - 4));
    return `${head}${stars}${tail}`;
  }

  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  const stars = "*".repeat(Math.min(12, Math.max(4, value.length - 8)));
  return `${head}${stars}${tail}`;
}

function blobToBase64Payload(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.includes(",") ? text.split(",")[1] : text);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function copyUrlForEmbedding(url: string): Promise<boolean> {
  const clipboard = navigator?.clipboard;
  const ClipboardCtor = window?.ClipboardItem;

  if (!clipboard) {
    return false;
  }

  if (clipboard.write && ClipboardCtor) {
    try {
      const html = `<img src="${url}" alt="dyno report" />`;
      const item = new ClipboardCtor({
        "text/plain": new Blob([url], { type: "text/plain" }),
        "text/uri-list": new Blob([url], { type: "text/uri-list" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await clipboard.write([item]);
      return true;
    } catch {
      // fallback to plain text
    }
  }

  if (clipboard.writeText) {
    try {
      await clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

interface InlineEditableProps {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  multiline?: boolean;
  maxLength?: number;
}

interface InlineEditableSelectProps {
  value: string;
  options: string[];
  onCommit: (value: string) => void;
  className?: string;
}

function InlineEditable({
  value,
  onCommit,
  className = "",
  multiline = false,
  maxLength,
}: InlineEditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const finish = () => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          className={`inline-editable-input inline-editable-textarea ${className}`.trim()}
          value={draft}
          maxLength={maxLength}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              finish();
            }
          }}
        />
      );
    }

    return (
      <input
        type="text"
        className={`inline-editable-input ${className}`.trim()}
        value={draft}
        maxLength={maxLength}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`inline-editable-display ${className}`.trim()}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || "-"}
    </button>
  );
}

function InlineEditableSelect({
  value,
  options,
  onCommit,
  className = "",
}: InlineEditableSelectProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        className={`inline-editable-input inline-editable-select ${className}`.trim()}
        value={value}
        autoFocus
        onChange={(event) => {
          onCommit(event.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      className={`inline-editable-display ${className}`.trim()}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || "-"}
    </button>
  );
}

async function prepareUploadBlob(blob: Blob | null, maxDimension = 1920) {
  if (!blob) {
    return null;
  }

  if (typeof window === "undefined") {
    return blob;
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(blob);
    const imageUrl = objectUrl;
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const longestSide = Math.max(sourceWidth, sourceHeight);

    if (longestSide <= maxDimension) {
      return blob;
    }

    const scale = maxDimension / longestSide;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(objectUrl);
      return blob;
    }

    ctx.fillStyle = "#101624";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const resized = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png", 1);
    });

    return resized || blob;
  } catch {
    return blob;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function App() {
  const [persistedState] = useState(getPersistedState);
  const [data, setData] = useState(persistedState.data);
  const [showHp, setShowHp] = useState(persistedState.showHp);
  const [showTq, setShowTq] = useState(persistedState.showTq);
  const [hasStarted, setHasStarted] = useState(() => {
    const lastSeenRaw = getStoredValue(SPLASH_LAST_SEEN_KEY, "0");
    const lastSeen = Number(lastSeenRaw || 0);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
      return false;
    }

    return Date.now() - lastSeen < SPLASH_SKIP_WINDOW_MS;
  });
  const [mainApiKey, setMainApiKey] = useState(() =>
    getStoredValue(API_KEY_STORAGE_KEY),
  );
  const [imgbbApiKey, setImgbbApiKey] = useState(() =>
    getStoredValue(IMGBB_API_KEY_STORAGE_KEY),
  );
  const [uploadProvider, setUploadProvider] = useState<UploadProvider>(() => {
    const stored = getStoredValue(UPLOAD_PROVIDER_STORAGE_KEY);
    return toUploadProvider(stored);
  });
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<UploadProvider>(UPLOAD_PROVIDERS.primary);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RecentUpload[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [currentSearchPage, setCurrentSearchPage] = useState(1);
  const toastTimerRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const searchResultsListRef = useRef<HTMLDivElement | null>(null);
  const [docMeta] = useState(() => {
    const unixId = Math.floor(Date.now() / 1000);
    const createdAt = new Date(unixId * 1000).toLocaleString("bg-BG", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return { unixId, createdAt };
  });

  const vehicleName = data.model.trim();

  const summary = `Сервиз: ${SHOP_NAME}\nМодел: ${vehicleName}\nMax WHP: ${data.whp}\nMax WTQ: ${data.wtq}\nBoost/AFR: ${data.psi.toFixed(
    1,
  )} psi / ${data.afr.toFixed(1)}\nMax RPM: ${data.rpm}\nВъншна темп: ${data.extTemp}\nВлажност: ${data.humidity}%\nКорекционен фактор: ${data.correctionFactor}\nID: ${docMeta.unixId}\nОператор: ${data.operator}\nСобственик: ${data.owner}\nСъздаден: ${docMeta.createdAt}\nБележки: ${data.mechanicNotes}`;

  const updateMetric =
    (key: MetricKey) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = Number(event.target.value);
      setData((prev) => ({
        ...prev,
        [key]: normalizeMetricValue(key, raw),
      }));
    };

  const updateMetricInput = (item: SliderItem) => (event: ChangeEvent<HTMLInputElement>) => {
    const rawText = event.target.value;
    const parsed = Number(rawText);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const clamped = Math.max(item.min, Math.min(item.max, parsed));
    const nextValue = normalizeMetricValue(item.key, clamped);
    setData((prev) => ({ ...prev, [item.key]: nextValue }));
  };

  const applyInlineUpdate = (key: keyof DynoData, rawValue: string) => {
    if (isMetricKey(key)) {
      const normalizedText = rawValue.replace(",", ".").trim();
      const parsed = Number(normalizedText);
      if (!Number.isFinite(parsed)) {
        return;
      }

      const bounds = METRIC_BOUNDS[key];
      const clamped = Math.max(bounds.min, Math.min(bounds.max, parsed));
      const normalized = normalizeMetricValue(key, clamped);
      setData((prev) => ({ ...prev, [key]: normalized }));
      return;
    }

    if (key === "mechanicNotes") {
      setData((prev) => ({
        ...prev,
        mechanicNotes: rawValue.slice(0, MECHANIC_NOTES_MAX_LENGTH),
      }));
      return;
    }

    setData((prev) => ({ ...prev, [key]: rawValue }));
  };

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToast({ message: withTrailingDot(message), tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2200);
  };

  const handleReset = () => setData(defaults);

  const rememberRecentUpload = (
    url: string,
    provider: UploadProvider | "unknown",
    fileName = "",
  ) => {
    if (!url) {
      return;
    }

    const normalized = String(url).trim();
    if (!normalized) {
      return;
    }

    const nextItem = {
      url: normalized,
      provider,
      createdAt: Date.now(),
      fileName,
    };

    const existing = readRecentUploads();
    const merged = mergeRecentUploads(existing, [nextItem]);
    setStoredValue(RECENT_UPLOADS_STORAGE_KEY, JSON.stringify(merged));
  };

  const setSearchOutcome = (items: RecentUpload[]) => {
    setSearchResults(items);
    setHasSearched(true);
    setCurrentSearchPage(1);
  };

  const handleApiSearch = async () => {
    if (uploadProvider !== UPLOAD_PROVIDERS.primary || isSearching) {
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      showToast("Въведи текст за търсене", "info");
      return;
    }

    if (!mainApiKey) {
      setProviderDraft(UPLOAD_PROVIDERS.primary);
      openApiModal();
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({
        q: query,
        query,
        filename: `*${query}*`,
      });
      const response = await fetch(`${PRIMARY_API_BASE}/search?${params.toString()}`, {
        method: "GET",
        headers: {
          "X-API-Key": mainApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const result = await response.json().catch(() => null);
      const normalized = normalizeApiSearchResults(result);
      setSearchOutcome(normalized);
      showToast(
        normalized.length
          ? `Намерени ${normalized.length} файла`
          : "Няма съвпадения за това търсене",
        normalized.length ? "success" : "info",
      );
    } catch {
      setSearchOutcome([]);
      showToast("Грешка при търсене в API", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyResultUrl = async (url: string) => {
    const copied = await copyUrlForEmbedding(url);
    showToast(copied ? "URL е копиран" : "Неуспешно копиране на URL", copied ? "success" : "error");
  };

  const handleDownload = async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      const blob = await getBestCaptureBlob();
      if (!blob) {
        showToast("Грешка при генериране на изображение", "error");
        return;
      }

      const fileName = buildReportFileName(data.model, data.plate);

      downloadBlob(blob, fileName);
      showToast("Изображението е изтеглено", "success");
    } catch {
      showToast("Грешка при генериране на изображение", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const renderPreviewBlob = async (scale = EXPORT_RENDER_SCALE): Promise<Blob | null> => {
    if (!previewRef.current) {
      return null;
    }

    await waitForPreviewReady(previewRef.current);

    const target = previewRef.current;
    const exportWidth = EXPORT_WIDTH;
    let exportHeight = 0;

    let canvas;
    try {
      canvas = await html2canvas(target, {
        scale,
        useCORS: true,
        backgroundColor: "#101624",
        imageTimeout: 0,
        removeContainer: true,
        logging: false,
        windowWidth: exportWidth,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.classList.add("capture-mode");
          const clonedPreview = clonedDoc.getElementById("report-preview");
          if (clonedPreview) {
            clonedPreview.style.position = "fixed";
            clonedPreview.style.left = "0";
            clonedPreview.style.top = "0";
            clonedPreview.style.margin = "0";
            clonedPreview.style.width = `${exportWidth}px`;
            clonedPreview.style.maxWidth = `${exportWidth}px`;
            clonedPreview.style.minWidth = `${exportWidth}px`;
            clonedPreview.style.height = "auto";
            clonedPreview.style.maxHeight = "none";
            clonedPreview.style.minHeight = "0";
            clonedPreview.style.overflow = "visible";
            clonedPreview.style.transform = "none";

            exportHeight = Math.max(
              1,
              Math.ceil(
                clonedPreview.scrollHeight || clonedPreview.clientHeight,
              ),
            );
            clonedPreview.style.height = `${exportHeight}px`;
          }
        },
      });
    } catch {
      return null;
    }

    const outputWidth = exportWidth;
    const outputHeight = Math.max(
      1,
      exportHeight ||
        Math.round((canvas.height / Math.max(1, canvas.width)) * outputWidth),
    );

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) {
      return null;
    }

    outputCtx.drawImage(canvas, 0, 0, outputWidth, outputHeight);

    return new Promise<Blob | null>((resolve) => {
      outputCanvas.toBlob((blob) => resolve(blob), "image/png", 1);
    });
  };

  const getBestCaptureBlob = async (): Promise<Blob | null> => {
    let blob = await renderPreviewBlob(4);
    if (!isValidImageBlob(blob)) {
      blob = await renderPreviewBlob(3);
    }
    return isValidImageBlob(blob) ? blob : null;
  };

  const handleCopy = async () => {
    if (isCopying) {
      return;
    }

    setIsCopying(true);
    const clipboard = navigator?.clipboard;
    const ClipboardCtor = window?.ClipboardItem as typeof ClipboardItem | undefined;

    try {
      try {
        if (clipboard?.write && ClipboardCtor) {
          const blob = await getBestCaptureBlob();
          if (blob) {
            await clipboard.write([new ClipboardCtor({ "image/png": blob })]);
            showToast("Изображението е копирано", "success");
            return;
          }
        }
      } catch {
        // Fallbacks below
      }

      try {
        if (clipboard?.writeText) {
          await clipboard.writeText(summary);
          showToast("Копирани са текстовите данни", "info");
          return;
        }
      } catch {
        // Final fallback below
      }

      const blob = await renderPreviewBlob(3);
      if (isValidImageBlob(blob)) {
        downloadBlob(blob, "faka-dyno-copy-fallback.png");
        showToast("Clipboard е блокиран, изтеглен е fallback файл", "info");
        return;
      }

      showToast("Неуспешно копиране", "error");
    } finally {
      setIsCopying(false);
    }
  };

  const openApiModal = () => {
    setProviderDraft(uploadProvider);
    setApiKeyDraft("");
    setIsApiModalOpen(true);
  };

  const closeApiModal = () => {
    setIsApiModalOpen(false);
  };

  const saveApiKey = () => {
    setUploadProvider(providerDraft);
    setStoredValue(UPLOAD_PROVIDER_STORAGE_KEY, providerDraft);

    const nextKey = apiKeyDraft.trim();
    if (!nextKey) {
      setIsApiModalOpen(false);
      showToast("Настройките са запазени", "success");
      return;
    }

    if (providerDraft === UPLOAD_PROVIDERS.imgbb) {
      setImgbbApiKey(nextKey);
      setStoredValue(IMGBB_API_KEY_STORAGE_KEY, nextKey);
    } else {
      setMainApiKey(nextKey);
      setStoredValue(API_KEY_STORAGE_KEY, nextKey);
    }

    setIsApiModalOpen(false);
    showToast("API ключът е запазен", "success");
  };

  const activeDraftStoredKey =
    providerDraft === UPLOAD_PROVIDERS.imgbb ? imgbbApiKey : mainApiKey;

  const maskedApiKeyPlaceholder = activeDraftStoredKey
    ? maskApiKey(activeDraftStoredKey)
    : providerDraft === UPLOAD_PROVIDERS.imgbb
      ? "Въведи imgbb API key"
      : "Постави тайния сос, без него няма upload магия";

  const handleUpload = async () => {
    if (isUploading) {
      return;
    }

    const activeApiKey =
      uploadProvider === UPLOAD_PROVIDERS.imgbb ? imgbbApiKey : mainApiKey;

    if (!activeApiKey) {
      openApiModal();
      return;
    }

    setIsUploading(true);

    try {
      const blob = await getBestCaptureBlob();
      if (!blob) {
        showToast("Грешка при подготовка на файла", "error");
        return;
      }

      const uploadBlob = await prepareUploadBlob(blob, 1920);
      if (!isValidImageBlob(uploadBlob)) {
        showToast("Грешка при оптимизация на файла", "error");
        return;
      }

      const fileName = buildReportFileName(data.model, data.plate);

      try {
        let response;

        if (uploadProvider === UPLOAD_PROVIDERS.imgbb) {
          const imagePayload = await blobToBase64Payload(uploadBlob);
          const body = new FormData();
          body.append("image", imagePayload);
          body.append("name", fileName.replace(/\.png$/i, ""));

          response = await fetch(
            `https://api.imgbb.com/1/upload?key=${encodeURIComponent(activeApiKey)}`,
            {
              method: "POST",
              body,
            },
          );
        } else {
          const formData = new FormData();
          formData.append("file", uploadBlob, fileName);

          response = await fetch(`${PRIMARY_API_BASE}/upload`, {
            method: "POST",
            headers: {
              "X-API-Key": activeApiKey,
            },
            body: formData,
          });
        }

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        const result = await response.json().catch(() => null);
        const uploadedUrl = extractUploadedUrl(result, uploadProvider);

        if (uploadedUrl) {
          rememberRecentUpload(uploadedUrl, uploadProvider, fileName);
          const copied = await copyUrlForEmbedding(uploadedUrl);
          if (copied) {
            showToast("Файлът е качен, URL е копиран", "success");
          } else {
            showToast("Файлът е качен успешно", "success");
          }
        } else {
          showToast("Файлът е качен (липсва URL в отговора)", "info");
        }
      } catch {
        downloadBlob(uploadBlob, fileName);
        showToast("Upload неуспешен, файлът е изтеглен локално", "info");
      }
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const writeState = () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          data,
          showHp,
          showTq,
        }),
      );
    };

    const timer = window.setTimeout(writeState, 180);
    return () => window.clearTimeout(timer);
  }, [data, showHp, showTq]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hasStarted) {
      return;
    }

    setStoredValue(SPLASH_LAST_SEEN_KEY, String(Date.now()));
  }, [hasStarted]);

  useEffect(() => {
    if (uploadProvider === UPLOAD_PROVIDERS.primary) {
      return;
    }

    setHasSearched(false);
    setSearchResults([]);
  }, [uploadProvider]);

  const displayedUploads = hasSearched ? searchResults : [];
  const totalSearchPages = Math.max(
    1,
    Math.ceil(displayedUploads.length / SEARCH_PAGE_SIZE),
  );
  const safeCurrentPage = Math.min(currentSearchPage, totalSearchPages);
  const pagedUploads = displayedUploads.slice(
    (safeCurrentPage - 1) * SEARCH_PAGE_SIZE,
    safeCurrentPage * SEARCH_PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentSearchPage((prev) => {
      const clamped = Math.max(1, Math.min(prev, totalSearchPages));
      return clamped;
    });
  }, [totalSearchPages]);

  useEffect(() => {
    if (!searchResultsListRef.current) {
      return;
    }

    searchResultsListRef.current.scrollTo({ top: 0, behavior: "auto" });
  }, [safeCurrentPage]);

  if (!hasStarted) {
    return (
      <main className="splash-screen">
        <button
          type="button"
          className="splash-trigger"
          onClick={() => setHasStarted(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              setHasStarted(true);
            }
          }}
        >
          <img src={logo} alt="FAKA Performance" className="splash-logo" />
          <span>Натисни за старт</span>
        </button>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="layout">
        <aside className="form-panel">
          <div className="form-content">
            <div className="section-block sliders">
              <h2>ДИНО ДАННИ</h2>
              {sliderConfig.map((item) => (
                <label className="slider-row" key={item.key}>
                  <span>{item.label}</span>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={data[item.key]}
                    onChange={updateMetric(item.key)}
                    style={
                      {
                        "--progress": `${Math.max(
                          0,
                          Math.min(
                            100,
                            ((data[item.key] - item.min) /
                              (item.max - item.min || 1)) *
                              100,
                          ),
                        )}%`,
                      } as CSSProperties
                    }
                  />
                  <input
                    className="slider-value-input"
                    type="text"
                    value={formatMetricValue(item.key, data[item.key])}
                    onChange={updateMetricInput(item)}
                  />
                </label>
              ))}
            </div>

            {uploadProvider === UPLOAD_PROVIDERS.primary && (
              <div className="section-block search-tools">
                <h2>ТЪРСЕНЕ НА КАЧВАНИЯ</h2>
                <div className="search-row">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleApiSearch();
                      }
                    }}
                    placeholder={`*${data.plate}*`}
                    disabled={isSearching}
                  />
                <button type="button" onClick={handleApiSearch} disabled={isSearching}>
                  {isSearching ? "Търсене..." : "Търси"}
                </button>
                </div>

                <div className="search-results-panel">
                  {!displayedUploads.length ? (
                    <p className="search-empty">
                      {hasSearched
                        ? "Няма резултати от API търсенето"
                        : "Въведи номер/име и натисни Търси"}
                    </p>
                  ) : (
                    <>
                      <div className="search-results-list" ref={searchResultsListRef}>
                        {pagedUploads.map((item) => (
                          <article className="search-result-row" key={item.url}>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="search-result-thumb"
                            >
                              <img
                                src={item.url}
                                alt="Търсене dyno report"
                                loading="lazy"
                              />
                            </a>
                            <div className="search-result-meta">
                              <p>{item.fileName || "unnamed-file"}</p>
                              <span>
                                provider: {item.provider === UPLOAD_PROVIDERS.imgbb ? "imgbb" : "main"}
                              </span>
                              <span>{formatRecentUploadTime(item.createdAt)}</span>
                            </div>
                            <div className="search-result-actions">
                              <button
                                type="button"
                                title="Copy URL"
                                onClick={() => handleCopyResultUrl(item.url)}
                              >
                                <Copy aria-hidden="true" />
                              </button>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                title="Open file"
                              >
                                <Eye aria-hidden="true" />
                              </a>
                            </div>
                          </article>
                        ))}
                      </div>

                      <div className="search-pagination">
                        <button
                          type="button"
                          onClick={() => setCurrentSearchPage((prev) => Math.max(1, prev - 1))}
                          disabled={safeCurrentPage <= 1}
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentSearchPage((prev) => Math.min(totalSearchPages, prev + 1))
                          }
                          disabled={safeCurrentPage >= totalSearchPages}
                        >
                          Next
                        </button>
                        <span>
                          {safeCurrentPage} of {totalSearchPages}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="preview-panel" id="report-preview" ref={previewRef}>
          <header className="preview-header">
            <div>
              <p className="shop-name">{SHOP_NAME}</p>
              <h3>
                <InlineEditable
                  value={vehicleName}
                  onCommit={(next) => applyInlineUpdate("model", next)}
                />
              </h3>
              <div className="vehicle-submeta">
                <span>Създаден: {docMeta.createdAt}</span>
                <span>ID: {docMeta.unixId}</span>
                <span>
                  Оператор:{" "}
                  <InlineEditable
                    value={data.operator}
                    onCommit={(next) => applyInlineUpdate("operator", next)}
                  />
                </span>
                <span>
                  Собственик:{" "}
                  <InlineEditable
                    value={data.owner}
                    onCommit={(next) => applyInlineUpdate("owner", next)}
                  />
                </span>
              </div>
            </div>
            <div className="brand-mark" aria-label="FAKA logo">
              <img src={logo} alt="FAKA Performance" />
            </div>
          </header>

          <div className="stat-row">
            <article>
              <p>МОЩНОСТ НА КОЛЕЛА</p>
              <h4>{data.whp} WHP</h4>
            </article>
            <article>
              <p>МАКС ВЪРТЯЩ МОМЕНТ</p>
              <h4>{data.wtq} WTQ</h4>
            </article>
            <article>
              <p>BOOST / AFR</p>
              <h4>
                {data.psi.toFixed(1)} psi / {data.afr.toFixed(1)} AFR
              </h4>
            </article>
          </div>

          <div className="graph-shell">
            <div className="graph-main">
              <DynoGraph
                whp={data.whp}
                wtq={data.wtq}
                rpm={data.rpm}
                showHp={showHp}
                showTq={showTq}
              />
              <div className="graph-legend-inside">
                <button
                  type="button"
                  className={showHp ? "is-on" : "is-off"}
                  onClick={() => setShowHp((prev) => !prev)}
                >
                  <i className="legend-hp" /> HP линия
                </button>
                <button
                  type="button"
                  className={showTq ? "is-on" : "is-off"}
                  onClick={() => setShowTq((prev) => !prev)}
                >
                  <i className="legend-tq" /> TQ линия
                </button>
              </div>
            </div>
            <RpmGauge rpm={data.rpm} />
          </div>

          <div className="preview-meta">
            <p>
              <span>Двигател</span>
              <strong>
                <InlineEditable
                  value={data.engine}
                  onCommit={(next) => applyInlineUpdate("engine", next)}
                />
              </strong>
            </p>
            <p>
              <span>Рег. номер</span>
              <strong>
                <InlineEditable
                  value={data.plate}
                  onCommit={(next) => applyInlineUpdate("plate", next)}
                />
              </strong>
            </p>
            <p>
              <span>Задвижване</span>
              <strong>
                <InlineEditableSelect
                  value={data.drivetrain}
                  options={["AWD", "RWD", "FWD"]}
                  onCommit={(next) => applyInlineUpdate("drivetrain", next)}
                />
              </strong>
            </p>
          </div>

          <footer className="doc-footer">
            <div className="tech-grid">
              <div>
                <span>Външна темп</span>
                <strong>
                  <InlineEditable
                    value={data.extTemp}
                    onCommit={(next) => applyInlineUpdate("extTemp", next)}
                  />
                </strong>
              </div>
              <div>
                <span>Влажност</span>
                <strong>
                  <InlineEditable
                    value={data.humidity}
                    onCommit={(next) => applyInlineUpdate("humidity", next)}
                  />
                  %
                </strong>
              </div>
              <div>
                <span>Max RPM</span>
                <strong>{data.rpm}</strong>
              </div>
              <div>
                <span>Кор. фактор</span>
                <strong>
                  <InlineEditable
                    value={data.correctionFactor}
                    onCommit={(next) => applyInlineUpdate("correctionFactor", next)}
                  />
                </strong>
              </div>
            </div>
          </footer>

          <div className="mechanic-notes">
            <p className="notes-title">Бележки на механика</p>
            <p>
              <InlineEditable
                value={data.mechanicNotes}
                multiline
                maxLength={MECHANIC_NOTES_MAX_LENGTH}
                className="inline-notes-display"
                onCommit={(next) => applyInlineUpdate("mechanicNotes", next)}
              />
            </p>
          </div>

          <div className="signature">
            {data.operator}
          </div>
        </section>
      </section>

      <div className="quick-actions" aria-label="Report quick actions">
        <button type="button" title="Settings" onClick={openApiModal}>
          <span>Settings</span>
          <Settings aria-hidden="true" />
        </button>
        <button type="button" title="Reset" onClick={handleReset}>
          <span>Reset</span>
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Download"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          <span>Download</span>
          <Download aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Copy"
          onClick={handleCopy}
          disabled={isCopying}
        >
          <span>Copy</span>
          <Copy aria-hidden="true" />
        </button>
        <button type="button" title="Upload" onClick={handleUpload} disabled={isUploading}>
          <span>Upload</span>
          <Upload aria-hidden="true" />
        </button>
      </div>

      {isApiModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="API key settings"
        >
          <div className="api-modal">
            <h3>API Настройки</h3>
            <label>
              Hosting provider
              <select
                value={providerDraft}
                onChange={(event) => {
                  const nextProvider = toUploadProvider(event.target.value);
                  setProviderDraft(nextProvider);
                  setApiKeyDraft("");
                }}
              >
                <option value={UPLOAD_PROVIDERS.primary}>
                  FAKA Upload (main)
                </option>
                <option value={UPLOAD_PROVIDERS.imgbb}>imgbb (backup)</option>
              </select>
            </label>
            <label>
              {providerDraft === UPLOAD_PROVIDERS.imgbb
                ? "Въведи imgbb API ключ"
                : "Въведи FAKA API ключ"}
              <input
                type="text"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder={maskedApiKeyPlaceholder}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={closeApiModal}>
                <X aria-hidden="true" />
                Отказ
              </button>
              <button type="button" onClick={saveApiKey}>
                <Check aria-hidden="true" />
                Запази
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`toast toast-${toast.tone}`}
          role="status"
          aria-live="polite"
        >
          <span className="toast-dot" aria-hidden="true" />
          {toast.message}
        </div>
      )}
    </main>
  );
}

export default App;