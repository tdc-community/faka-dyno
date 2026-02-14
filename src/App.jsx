import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import logo from "./assets/logo.png";

const SHOP_NAME = "FAKA PERFORMANCE";

const defaults = {
  model: "Bravado Banshee 900R",
  engine: "V8 TT",
  plate: "FAKA-900R",
  drivetrain: "RWD",
  fuel: "E85",
  extTemp: "24 C",
  humidity: "52",
  correctionFactor: "1.02",
  operator: "A. Mercer",
  owner: "Franklin Clinton",
  mechanicNotes: "Проверен бууст контролер. Няма детонации при пълен товар.",
  whp: 618,
  wtq: 575,
  psi: 23.0,
  afr: 11.9,
  rpm: 7900,
};

const sliderConfig = [
  { key: "whp", label: "Max HP", min: 300, max: 1200, step: 1 },
  { key: "wtq", label: "Max TQ", min: 300, max: 1200, step: 1 },
  { key: "psi", label: "Boost PSI", min: 5, max: 40, step: 0.1 },
  { key: "afr", label: "AFR", min: 9, max: 14, step: 0.1 },
  { key: "rpm", label: "Max RPM", min: 4500, max: 9000, step: 50 },
];

const MECHANIC_NOTES_MAX_LENGTH = 320;
const STORAGE_KEY = "faka-dyno-state-v1";
const API_KEY_STORAGE_KEY = "faka-dyno-api-key";
const IMGBB_API_KEY_STORAGE_KEY = "faka-dyno-imgbb-api-key";
const UPLOAD_PROVIDER_STORAGE_KEY = "faka-dyno-upload-provider";

const UPLOAD_PROVIDERS = {
  primary: "primary",
  imgbb: "imgbb",
};

const DEFAULT_STORAGE_STATE = {
  data: defaults,
  showHp: true,
  showTq: true,
};

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function getPersistedState() {
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

function sanitizeForFile(value) {
  return (
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "na"
  );
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildReportFileName(
  model,
  plate,
  unixTimestamp = Math.floor(Date.now() / 1000),
) {
  const safeModel = sanitizeForFile(model);
  const safeRegNumber = sanitizeForFile(plate);
  return `faka-dyno-${safeModel}-${safeRegNumber}-${unixTimestamp}.png`;
}

async function waitForPreviewReady(previewElement) {
  if (!previewElement) {
    return;
  }

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = Array.from(previewElement.querySelectorAll("img"));
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

function isValidImageBlob(blob) {
  return Boolean(blob && blob.type === "image/png" && blob.size > 20000);
}

function maskApiKey(value) {
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

function blobToBase64Payload(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.includes(",") ? text.split(",")[1] : text);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function copyUrlForEmbedding(url) {
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

async function prepareUploadBlob(blob, maxDimension = 1920) {
  if (!blob) {
    return null;
  }

  if (typeof window === "undefined") {
    return blob;
  }

  let objectUrl = null;

  try {
    objectUrl = URL.createObjectURL(blob);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
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

    const resized = await new Promise((resolve) => {
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

function toPath(points) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(" ");
}

function toSmoothPath(points) {
  if (points.length < 2) {
    return toPath(points);
  }

  const path = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.push(
      `C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`,
    );
  }

  return path.join(" ");
}

function DynoGraph({ whp, wtq, rpm, psi, afr, showHp, showTq }) {
  const width = 900;
  const height = 430;
  const pad = { top: 24, right: 24, bottom: 44, left: 52 };

  const chart = useMemo(() => {
    const minRpm = 2000;
    const maxRpm = Math.max(minRpm + 1200, rpm);
    const yMax = Math.max(900, Math.ceil((Math.max(whp, wtq) + 120) / 50) * 50);
    const steps = 220;

    const xScale = (value) =>
      pad.left +
      ((value - minRpm) / (maxRpm - minRpm)) * (width - pad.left - pad.right);
    const yScale = (value) =>
      pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);

    const hpCurve = [];
    const tqCurve = [];

    const sigmoid = (x) => 1 / (1 + Math.exp(-x));

    const tqRawSamples = [];
    const hpRawSamples = [];
    for (let i = 0; i <= steps; i += 1) {
      const currentRpm = minRpm + (i / steps) * (maxRpm - minRpm);

      const rise = sigmoid((currentRpm - 3600) / 760);
      const fallCenter = minRpm + (maxRpm - minRpm) * 0.84;
      const fall = sigmoid((currentRpm - fallCenter) / 650);
      const tqRaw = 0.34 + 0.86 * rise - 0.34 * fall;

      tqRawSamples.push({ rpm: currentRpm, tqRaw });
    }

    const tqRawPeak = Math.max(...tqRawSamples.map((item) => item.tqRaw));
    const tqScale = wtq / (tqRawPeak || 1);

    for (const item of tqRawSamples) {
      const tqValue = item.tqRaw * tqScale;
      const hpRawValue = (tqValue * item.rpm) / 5252;
      hpRawSamples.push({ rpm: item.rpm, tqValue, hpRawValue });
    }

    const hpRawPeak = Math.max(...hpRawSamples.map((item) => item.hpRawValue));
    const hpScale = whp / (hpRawPeak || 1);

    for (let i = 0; i <= steps; i += 1) {
      const currentRpm = hpRawSamples[i].rpm;
      const tqValue = hpRawSamples[i].tqValue;
      const hpValue = hpRawSamples[i].hpRawValue * hpScale;

      hpCurve.push({ x: xScale(currentRpm), y: yScale(hpValue) });
      tqCurve.push({ x: xScale(currentRpm), y: yScale(tqValue) });
    }

    const xTicks = Array.from({ length: 9 }, (_, index) => {
      const value = minRpm + (index / 8) * (maxRpm - minRpm);
      return Math.round(value / 100) * 100;
    });
    const yTicks = [0, 150, 300, 450, 600, 750, 900, yMax].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );

    return {
      xTicks,
      yTicks,
      hpPath: toSmoothPath(hpCurve),
      tqPath: toSmoothPath(tqCurve),
      xScale,
      yScale,
    };
  }, [whp, wtq, rpm]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Dyno horsepower and torque graph"
    >
      <rect x="0" y="0" width={width} height={height} fill="transparent" />

      {chart.yTicks.map((tick) => (
        <line
          key={`y-${tick}`}
          x1={pad.left}
          y1={chart.yScale(tick)}
          x2={width - pad.right}
          y2={chart.yScale(tick)}
          className="grid-line"
        />
      ))}

      {chart.xTicks.map((tick) => (
        <line
          key={`x-${tick}`}
          x1={chart.xScale(tick)}
          y1={pad.top}
          x2={chart.xScale(tick)}
          y2={height - pad.bottom}
          className="grid-line"
        />
      ))}

      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={height - pad.bottom}
        className="axis-line"
      />
      <line
        x1={pad.left}
        y1={height - pad.bottom}
        x2={width - pad.right}
        y2={height - pad.bottom}
        className="axis-line"
      />

      {showTq && <path d={chart.tqPath} className="curve curve-tq" />}
      {showHp && <path d={chart.hpPath} className="curve curve-hp" />}

      {chart.xTicks.map((tick) => (
        <text
          key={`xl-${tick}`}
          x={chart.xScale(tick)}
          y={height - 18}
          className="axis-label"
          textAnchor="middle"
        >
          {tick}
        </text>
      ))}

      {chart.yTicks.map((tick) => (
        <text
          key={`yl-${tick}`}
          x={pad.left - 8}
          y={chart.yScale(tick) + 4}
          className="axis-label"
          textAnchor="end"
        >
          {tick}
        </text>
      ))}

      <text
        x={width / 2}
        y={height - 2}
        className="axis-title"
        textAnchor="middle"
      >
        RPM
      </text>
      <text
        x="18"
        y={height / 2}
        className="axis-title"
        textAnchor="middle"
        transform={`rotate(-90 18 ${height / 2})`}
      >
        Power / Torque
      </text>

      <text x={width - 30} y={24} className="metric-chip" textAnchor="end">
        HP {whp} | TQ {wtq}
      </text>
      <text x={width - 30} y={42} className="metric-chip" textAnchor="end">
        Max RPM {rpm} | Boost {psi.toFixed(1)} | AFR {afr.toFixed(1)}
      </text>
    </svg>
  );
}

function RpmGauge({ rpm, minRpm = 2000, maxRpm = 9000, redline = 8500 }) {
  const clamped = Math.max(minRpm, Math.min(maxRpm, rpm));
  const ratio = (clamped - minRpm) / (maxRpm - minRpm || 1);
  const segments = 18;
  const activeCount = Math.round(ratio * segments);
  const redlineRatio =
    (Math.max(minRpm, Math.min(maxRpm, redline)) - minRpm) /
    (maxRpm - minRpm || 1);

  return (
    <aside className="rpm-gauge" aria-label="Peak RPM gauge">
      <p className="rpm-gauge-title">MAX RPM</p>
      <div className="rpm-gauge-track-wrap">
        <div className="rpm-gauge-track">
          {Array.from({ length: segments }, (_, index) => (
            <span
              key={`rpm-segment-${index}`}
              className={
                index >= segments - activeCount ? "segment active" : "segment"
              }
            />
          ))}
        </div>
        <span
          className="rpm-redline"
          style={{ bottom: `${redlineRatio * 100}%` }}
        />
      </div>
      <p className="rpm-gauge-value">{rpm}</p>
      <p className="rpm-gauge-range">
        {minRpm} - {maxRpm}
      </p>
    </aside>
  );
}

function App() {
  const [persistedState] = useState(getPersistedState);
  const [data, setData] = useState(persistedState.data);
  const [showHp, setShowHp] = useState(persistedState.showHp);
  const [showTq, setShowTq] = useState(persistedState.showTq);
  const [mainApiKey, setMainApiKey] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  });
  const [imgbbApiKey, setImgbbApiKey] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(IMGBB_API_KEY_STORAGE_KEY) || "";
  });
  const [uploadProvider, setUploadProvider] = useState(() => {
    if (typeof window === "undefined") {
      return UPLOAD_PROVIDERS.primary;
    }

    const stored = window.localStorage.getItem(UPLOAD_PROVIDER_STORAGE_KEY);
    return stored === UPLOAD_PROVIDERS.imgbb
      ? UPLOAD_PROVIDERS.imgbb
      : UPLOAD_PROVIDERS.primary;
  });
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState(UPLOAD_PROVIDERS.primary);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const previewRef = useRef(null);
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

  const updateText = (key) => (event) => {
    setData((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const updateMetric = (key) => (event) => {
    const raw = Number(event.target.value);
    setData((prev) => ({
      ...prev,
      [key]: key === "psi" || key === "afr" ? raw : Math.round(raw),
    }));
  };

  const showToast = (message, tone = "info") => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2200);
  };

  const handleReset = () => setData(defaults);

  const handleShuffle = () => {
    const randInt = (min, max) => Math.round(min + Math.random() * (max - min));
    const randFloat = (min, max, precision = 1) => {
      const value = min + Math.random() * (max - min);
      return Number(value.toFixed(precision));
    };

    const rpm = randInt(6200, 8600);
    const wtq = randInt(520, 1080);
    const whp = Math.round((wtq * rpm) / 7600);
    const psi = randFloat(18, 34, 1);
    const afr = randFloat(11.1, 12.3, 1);
    const extTemp = `${randInt(12, 36)} C`;
    const humidity = String(randInt(28, 74));
    const correctionFactor = randFloat(0.97, 1.04, 2).toFixed(2);

    setData((prev) => ({
      ...prev,
      whp,
      wtq,
      rpm,
      psi,
      afr,
      extTemp,
      humidity,
      correctionFactor,
      mechanicNotes:
        "Генерирани тестови стойности. Проверка на сместа и бууст налягането.",
    }));
  };

  const handleDownload = async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      let blob = await renderPreviewBlob(4);
      if (!isValidImageBlob(blob)) {
        blob = await renderPreviewBlob(3);
      }

      if (!isValidImageBlob(blob)) {
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

  const renderPreviewBlob = async (scale = 4) => {
    if (!previewRef.current) {
      return null;
    }

    await waitForPreviewReady(previewRef.current);

    const target = previewRef.current;

    let canvas;
    try {
      canvas = await html2canvas(target, {
        scale,
        useCORS: true,
        backgroundColor: "#101624",
        imageTimeout: 0,
        removeContainer: true,
        logging: false,
        width: target.clientWidth,
        height: target.clientHeight,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.classList.add("capture-mode");
        },
      });
    } catch {
      return null;
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png", 1);
    });
  };

  const handleCopy = async () => {
    if (isCopying) {
      return;
    }

    setIsCopying(true);
    const clipboard = navigator?.clipboard;
    const ClipboardCtor = window?.ClipboardItem;

    try {
      try {
        if (clipboard?.write && ClipboardCtor) {
          let blob = await renderPreviewBlob(4);
          if (!isValidImageBlob(blob)) {
            blob = await renderPreviewBlob(3);
          }

          if (isValidImageBlob(blob)) {
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UPLOAD_PROVIDER_STORAGE_KEY, providerDraft);
    }

    const nextKey = apiKeyDraft.trim();
    if (!nextKey) {
      setIsApiModalOpen(false);
      showToast("Настройките са запазени", "success");
      return;
    }

    if (providerDraft === UPLOAD_PROVIDERS.imgbb) {
      setImgbbApiKey(nextKey);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(IMGBB_API_KEY_STORAGE_KEY, nextKey);
      }
    } else {
      setMainApiKey(nextKey);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, nextKey);
      }
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
      let blob = await renderPreviewBlob(4);
      if (!isValidImageBlob(blob)) {
        blob = await renderPreviewBlob(3);
      }

      if (!isValidImageBlob(blob)) {
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

          response = await fetch("https://i.webproj.space/api/upload", {
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
        const uploadedUrl =
          uploadProvider === UPLOAD_PROVIDERS.imgbb
            ? result?.data?.url ||
              result?.data?.display_url ||
              result?.data?.url_viewer
            : result?.url;

        if (uploadedUrl) {
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

  return (
    <main className="app-shell">
      <section className="layout">
        <aside className="form-panel">
          <header className="form-header">
            <p className="kicker">РАБОТЕН ЛИСТ</p>
            <h1>Дино Таблет</h1>
            <p className="subtitle">
              Попълни данните за автомобила и дино теста
            </p>
          </header>

          <div className="form-content">
            <div className="section-block">
              <h2>ДАННИ ЗА АВТОМОБИЛА</h2>
              <div className="input-grid">
                <label>
                  Модел
                  <input
                    type="text"
                    value={data.model}
                    onChange={updateText("model")}
                  />
                </label>
                <label>
                  Двигател
                  <input
                    type="text"
                    value={data.engine}
                    onChange={updateText("engine")}
                  />
                </label>
                <label>
                  Рег. номер
                  <input
                    type="text"
                    value={data.plate}
                    onChange={updateText("plate")}
                  />
                </label>
                <label>
                  Задвижване
                  <select
                    value={data.drivetrain}
                    onChange={updateText("drivetrain")}
                  >
                    <option value="AWD">AWD</option>
                    <option value="RWD">RWD</option>
                    <option value="FWD">FWD</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="section-block">
              <h2>УСЛОВИЯ НА ТЕСТА</h2>
              <div className="input-grid">
                <label>
                  Гориво
                  <input
                    type="text"
                    value={data.fuel}
                    onChange={updateText("fuel")}
                  />
                </label>
                <label>
                  Външна темп
                  <input
                    type="text"
                    value={data.extTemp}
                    onChange={updateText("extTemp")}
                  />
                </label>
                <label>
                  Влажност %
                  <input
                    type="text"
                    value={data.humidity}
                    onChange={updateText("humidity")}
                  />
                </label>
                <label>
                  Корекционен фактор
                  <input
                    type="text"
                    value={data.correctionFactor}
                    onChange={updateText("correctionFactor")}
                  />
                </label>
              </div>
            </div>

            <div className="section-block">
              <h2>ДАННИ ЗА ДОКУМЕНТА</h2>
              <div className="input-grid">
                <label>
                  Оператор
                  <input
                    type="text"
                    value={data.operator}
                    onChange={updateText("operator")}
                  />
                </label>
                <label>
                  Собственик
                  <input
                    type="text"
                    value={data.owner}
                    onChange={updateText("owner")}
                  />
                </label>
              </div>
            </div>

            <div className="section-block sliders">
              <h2>ДИНО ТЕСТ С ТЕКУЩИ ДАННИ</h2>
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
                    style={{
                      "--progress": `${Math.max(
                        0,
                        Math.min(
                          100,
                          ((data[item.key] - item.min) /
                            (item.max - item.min || 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                  <strong>
                    {item.key === "psi" || item.key === "afr"
                      ? data[item.key].toFixed(1)
                      : data[item.key]}
                  </strong>
                </label>
              ))}
            </div>

            <div className="section-block notes-section">
              <h2>БЕЛЕЖКИ НА МЕХАНИКА</h2>
              <label>
                Бележки
                <div className="notes-input-wrap">
                  <textarea
                    value={data.mechanicNotes}
                    onChange={updateText("mechanicNotes")}
                    maxLength={MECHANIC_NOTES_MAX_LENGTH}
                  />
                  <span className="notes-counter">
                    {data.mechanicNotes.length}/{MECHANIC_NOTES_MAX_LENGTH}
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="utility-actions">
            <button type="button" title="Reset" onClick={handleReset}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5a7 7 0 1 1-6.95 8h2.1A5 5 0 1 0 12 7v3l-4-4 4-4z" />
              </svg>
            </button>
            <button type="button" title="Shuffle" onClick={handleShuffle}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17 3h4v4h-2V6.41l-5.29 5.3-1.42-1.42 5.3-5.29H17zm2 14h2v4h-4v-2h.59l-3.88-3.88 1.42-1.42L19 17.59V17zM3 7h4.59l9 9H21v2h-5.24l-9-9H3V7zm0 10h3.29l2-2 1.42 1.42L6.71 19H3v-2z" />
              </svg>
            </button>
            <button
              type="button"
              title="Download"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v10.59l3.3-3.29 1.4 1.41L12 18.41l-4.7-4.7 1.4-1.41L11 13.59V3zM5 19h14v2H5z" />
              </svg>
            </button>
            <button
              type="button"
              title="Upload"
              onClick={handleUpload}
              disabled={isUploading}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 20h14v-2H5zm7-18-5.5 5.5 1.42 1.42L11 5.84V16h2V5.84l3.08 3.08 1.42-1.42z" />
              </svg>
            </button>
            <button
              type="button"
              title="Copy"
              onClick={handleCopy}
              disabled={isCopying}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z" />
              </svg>
            </button>
          </div>
        </aside>

        <section className="preview-panel" ref={previewRef}>
          <header className="preview-header">
            <div>
              <p className="shop-name">{SHOP_NAME}</p>
              <h3>{vehicleName}</h3>
              <div className="vehicle-submeta">
                <span>Създаден: {docMeta.createdAt}</span>
                <span>ID: {docMeta.unixId}</span>
                <span>Оператор: {data.operator}</span>
                <span>Собственик: {data.owner}</span>
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
                psi={data.psi}
                afr={data.afr}
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
              <strong>{data.engine}</strong>
            </p>
            <p>
              <span>Рег. номер</span>
              <strong>{data.plate}</strong>
            </p>
            <p>
              <span>Задвижване</span>
              <strong>{data.drivetrain}</strong>
            </p>
          </div>

          <footer className="doc-footer">
            <div className="tech-grid">
              <div>
                <span>Гориво</span>
                <strong>{data.fuel}</strong>
              </div>
              <div>
                <span>Аванс</span>
                <strong>18.5 deg</strong>
              </div>
              <div>
                <span>Външна темп</span>
                <strong>{data.extTemp}</strong>
              </div>
              <div>
                <span>Влажност</span>
                <strong>{data.humidity}%</strong>
              </div>
              <div>
                <span>Max RPM</span>
                <strong>{data.rpm}</strong>
              </div>
              <div>
                <span>Кор. фактор</span>
                <strong>{data.correctionFactor}</strong>
              </div>
            </div>
          </footer>

          <div className="mechanic-notes">
            <p className="notes-title">Бележки на механика</p>
            <p>{data.mechanicNotes}</p>
            <div className="signature">{data.operator}</div>
          </div>
        </section>
      </section>

      <button
        type="button"
        className="settings-fab"
        title="API settings"
        onClick={openApiModal}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.13 7.13 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
        </svg>
      </button>

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
              Доставчик
              <select
                value={providerDraft}
                onChange={(event) => {
                  const nextProvider = event.target.value;
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.4 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.3 6.29-6.3z" />
                </svg>
                Отказ
              </button>
              <button type="button" onClick={saveApiKey}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
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