import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { Check, Copy, Download, RotateCcw, Settings, Upload, X } from "lucide-react";
import appPackage from "../package.json";
import logo from "./assets/logo.png";
import DynoGraph from "./components/DynoGraph";
import { InlineEditable, InlineEditableSelect } from "./components/InlineEditable";
import RpmGauge from "./components/RpmGauge";
import SearchPanel from "./components/SearchPanel";
import { useToast } from "./hooks/useToast";
import {
  getBestCaptureBlob,
  isValidImageBlob,
  prepareUploadBlob,
  renderPreviewBlob,
} from "./services/capture";
import { searchUploads, uploadReportImage } from "./services/api";
import {
  getPersistedState,
  getStoredValue,
  setStoredValue,
  STORAGE_KEYS,
} from "./services/storage";
import type {
  DynoData,
  MetricKey,
  RecentUpload,
  SliderItem,
  UploadProvider,
} from "./types";

const SHOP_NAME = "FAKA PERFORMANCE";
const APP_BUILD_LABEL = `Build: v${appPackage.version ?? "2.0.0"}`;

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
const SPLASH_SKIP_WINDOW_MS = 4 * 60 * 60 * 1000;
const EXPORT_WIDTH = 1000;
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

function App() {
  const [persistedState] = useState(() => getPersistedState(defaults));
  const [data, setData] = useState(persistedState.data);
  const [showHp, setShowHp] = useState(persistedState.showHp);
  const [showTq, setShowTq] = useState(persistedState.showTq);
  const [hasStarted, setHasStarted] = useState(() => {
    const lastSeenRaw = getStoredValue(STORAGE_KEYS.splashLastSeen, "0");
    const lastSeen = Number(lastSeenRaw || 0);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
      return false;
    }

    return Date.now() - lastSeen < SPLASH_SKIP_WINDOW_MS;
  });
  const [mainApiKey, setMainApiKey] = useState(() =>
    getStoredValue(STORAGE_KEYS.apiKey),
  );
  const [imgbbApiKey, setImgbbApiKey] = useState(() =>
    getStoredValue(STORAGE_KEYS.imgbbApiKey),
  );
  const [uploadProvider, setUploadProvider] = useState<UploadProvider>(() => {
    const stored = getStoredValue(STORAGE_KEYS.uploadProvider);
    return toUploadProvider(stored);
  });
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<UploadProvider>(UPLOAD_PROVIDERS.primary);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RecentUpload[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [currentSearchPage, setCurrentSearchPage] = useState(1);
  const apiModalRef = useRef<HTMLDivElement | null>(null);
  const { toast, showToast } = useToast();
  const previewRef = useRef<HTMLElement | null>(null);
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

  const handleReset = () => setData(defaults);

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
      showToast("Въведи текст за търсене.", "info");
      return;
    }

    if (!mainApiKey) {
      setProviderDraft(UPLOAD_PROVIDERS.primary);
      openApiModal();
      return;
    }

    setIsSearching(true);
    try {
      const normalized = await searchUploads(query, mainApiKey);
      setSearchOutcome(normalized);
      showToast(
        normalized.length
          ? `Намерени ${normalized.length} файла.`
          : "Няма съвпадения за това търсене.",
        normalized.length ? "success" : "info",
      );
    } catch {
      setSearchOutcome([]);
      showToast("Грешка при търсене в API.", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleResetSearch = () => {
    setSearchQuery("");
    setHasSearched(false);
    setSearchResults([]);
    setCurrentSearchPage(1);
  };

  const handleCopyResultUrl = async (url: string) => {
    const copied = await copyUrlForEmbedding(url);
    showToast(copied ? "URL е копиран." : "Неуспешно копиране на URL.", copied ? "success" : "error");
  };

  const handleDownload = async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      const blob = await getBestCurrentCaptureBlob();
      if (!blob) {
        showToast("Грешка при генериране на изображение.", "error");
        return;
      }

      const fileName = buildReportFileName(data.model, data.plate);

      downloadBlob(blob, fileName);
      showToast("Изображението е изтеглено.", "success");
    } catch {
      showToast("Грешка при генериране на изображение.", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const renderCurrentPreviewBlob = (scale: number): Promise<Blob | null> =>
    renderPreviewBlob({
      previewElement: previewRef.current,
      exportWidth: EXPORT_WIDTH,
      scale,
    });

  const getBestCurrentCaptureBlob = (): Promise<Blob | null> =>
    getBestCaptureBlob({
      previewElement: previewRef.current,
      exportWidth: EXPORT_WIDTH,
      preferredScales: [4, 3],
    });

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
          const blob = await getBestCurrentCaptureBlob();
          if (blob) {
            await clipboard.write([new ClipboardCtor({ "image/png": blob })]);
            showToast("Изображението е копирано.", "success");
            return;
          }
        }
      } catch {
        // Fallbacks below
      }

      try {
        if (clipboard?.writeText) {
          await clipboard.writeText(summary);
          showToast("Копирани са текстовите данни.", "info");
          return;
        }
      } catch {
        // Final fallback below
      }

      const blob = await renderCurrentPreviewBlob(3);
      if (isValidImageBlob(blob)) {
        downloadBlob(blob, "faka-dyno-copy-fallback.png");
        showToast("Clipboard е блокиран, изтеглен е fallback файл.", "info");
        return;
      }

      showToast("Неуспешно копиране.", "error");
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
    setStoredValue(STORAGE_KEYS.uploadProvider, providerDraft);

    const nextKey = apiKeyDraft.trim();
    if (!nextKey) {
      setIsApiModalOpen(false);
      showToast("Настройките са запазени.", "success");
      return;
    }

    if (providerDraft === UPLOAD_PROVIDERS.imgbb) {
      setImgbbApiKey(nextKey);
      setStoredValue(STORAGE_KEYS.imgbbApiKey, nextKey);
    } else {
      setMainApiKey(nextKey);
      setStoredValue(STORAGE_KEYS.apiKey, nextKey);
    }

    setIsApiModalOpen(false);
    showToast("API ключът е запазен.", "success");
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
      const blob = await getBestCurrentCaptureBlob();
      if (!blob) {
        showToast("Грешка при подготовка на файла.", "error");
        return;
      }

      const uploadBlob = await prepareUploadBlob(blob, 1920);
      if (!isValidImageBlob(uploadBlob)) {
        showToast("Грешка при оптимизация на файла.", "error");
        return;
      }

      const fileName = buildReportFileName(data.model, data.plate);

      try {
        const uploadedUrl = await uploadReportImage({
          provider: uploadProvider,
          activeApiKey,
          uploadBlob,
          fileName,
        });

        if (uploadedUrl) {
          const copied = await copyUrlForEmbedding(uploadedUrl);
          if (copied) {
            showToast("Файлът е качен, URL е копиран.", "success");
          } else {
            showToast("Файлът е качен успешно.", "success");
          }
        } else {
          showToast("Файлът е качен (липсва URL в отговора).", "info");
        }
      } catch {
        downloadBlob(uploadBlob, fileName);
        showToast("Upload неуспешен, файлът е изтеглен локално.", "info");
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
        STORAGE_KEYS.state,
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

  useEffect(() => {
    if (!hasStarted) {
      return;
    }

    setStoredValue(STORAGE_KEYS.splashLastSeen, String(Date.now()));
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
    if (!isApiModalOpen || !apiModalRef.current) {
      return;
    }

    const modal = apiModalRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => !element.hasAttribute("disabled"));

    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeApiModal();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !modal.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !modal.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isApiModalOpen]);

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

            <SearchPanel
              plate={data.plate}
              uploadProvider={uploadProvider}
              isSearching={isSearching}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSearch={handleApiSearch}
              onResetSearch={handleResetSearch}
              displayedUploads={displayedUploads}
              pagedUploads={pagedUploads}
              hasSearched={hasSearched}
              safeCurrentPage={safeCurrentPage}
              totalSearchPages={totalSearchPages}
              onPagePrev={() => setCurrentSearchPage((prev) => Math.max(1, prev - 1))}
              onPageNext={() =>
                setCurrentSearchPage((prev) => Math.min(totalSearchPages, prev + 1))
              }
              onCopyUrl={handleCopyResultUrl}
              formatRecentUploadTime={formatRecentUploadTime}
            />
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

      <p className="build-label">{APP_BUILD_LABEL}</p>

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
          <div className="api-modal" ref={apiModalRef}>
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
