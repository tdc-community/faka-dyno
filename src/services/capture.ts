import html2canvas from "html2canvas";

async function waitForPreviewReady(previewElement: HTMLElement | null): Promise<void> {
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

      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );

  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export function isValidImageBlob(blob: Blob | null): blob is Blob {
  return Boolean(blob && blob.type === "image/png" && blob.size > 20000);
}

export async function prepareUploadBlob(blob: Blob | null, maxDimension = 1920): Promise<Blob | null> {
  if (!blob) {
    return null;
  }

  if (typeof window === "undefined") {
    return blob;
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl as string;
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

export async function renderPreviewBlob(params: {
  previewElement: HTMLElement | null;
  exportWidth: number;
  scale: number;
}): Promise<Blob | null> {
  const { previewElement, exportWidth, scale } = params;
  if (!previewElement) {
    return null;
  }

  await waitForPreviewReady(previewElement);

  let exportHeight = 0;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(previewElement, {
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
            Math.ceil(clonedPreview.scrollHeight || clonedPreview.clientHeight),
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
    exportHeight || Math.round((canvas.height / Math.max(1, canvas.width)) * outputWidth),
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
}

export async function getBestCaptureBlob(params: {
  previewElement: HTMLElement | null;
  exportWidth: number;
  preferredScales?: number[];
}): Promise<Blob | null> {
  const { previewElement, exportWidth, preferredScales = [4, 3] } = params;

  for (const scale of preferredScales) {
    const blob = await renderPreviewBlob({ previewElement, exportWidth, scale });
    if (isValidImageBlob(blob)) {
      return blob;
    }
  }

  return null;
}
