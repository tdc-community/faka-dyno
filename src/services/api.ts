import type { RecentUpload, UploadProvider } from "../types";

export const PRIMARY_API_BASE = "https://webproj.space/fapi";

function ensureNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${field}: empty value.`);
  }

  return trimmed;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}

async function parseJsonOrThrow(
  response: Response,
  context: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const body = await safeReadResponseText(response);
    throw new Error(
      body
        ? `${context} returned non-JSON response: ${body.slice(0, 180)}.`
        : `${context} returned non-JSON response.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeAbsoluteUrl(value: unknown): string {
  if (typeof value !== "string") {
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
  if (explicitName) {
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
      provider: "primary",
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

function extractUploadedUrl(result: unknown, provider: UploadProvider): string {
  if (!isRecord(result)) {
    return "";
  }

  if (provider === "imgbb") {
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

async function blobToBase64Payload(blob: Blob): Promise<string> {
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

export async function searchUploads(
  query: string,
  apiKey: string,
): Promise<RecentUpload[]> {
  const safeQuery = ensureNonEmpty(query, "search query");
  const safeApiKey = ensureNonEmpty(apiKey, "API key");

  const params = new URLSearchParams({
    q: safeQuery,
  });

  const response = await fetch(
    `${PRIMARY_API_BASE}/search?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": safeApiKey,
      },
    },
  );

  if (!response.ok) {
    const body = await safeReadResponseText(response);
    throw new Error(
      body
        ? `Search failed (${response.status}): ${body.slice(0, 180)}.`
        : `Search failed (${response.status}).`,
    );
  }

  const payload = await parseJsonOrThrow(response, "Search API");
  return normalizeApiSearchResults(payload);
}

export async function uploadReportImage(params: {
  provider: UploadProvider;
  activeApiKey: string;
  uploadBlob: Blob;
  fileName: string;
}): Promise<string> {
  const { provider, uploadBlob } = params;
  const activeApiKey = ensureNonEmpty(params.activeApiKey, "API key");
  const fileName = ensureNonEmpty(params.fileName, "file name");

  if (!(uploadBlob instanceof Blob) || uploadBlob.size <= 0) {
    throw new Error("Invalid upload blob: empty payload.");
  }

  let response: Response;
  if (provider === "imgbb") {
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
    const body = await safeReadResponseText(response);
    throw new Error(
      body
        ? `Upload failed (${response.status}): ${body.slice(0, 180)}.`
        : `Upload failed (${response.status}).`,
    );
  }

  const result = await parseJsonOrThrow(response, "Upload API");
  return extractUploadedUrl(result, provider);
}