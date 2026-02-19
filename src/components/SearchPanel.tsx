import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import type { RecentUpload, UploadProvider } from "../types";

interface SearchPanelProps {
  plate: string;
  uploadProvider: UploadProvider;
  isSearching: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  onSearch: () => void;
  onResetSearch: () => void;
  displayedUploads: RecentUpload[];
  pagedUploads: RecentUpload[];
  hasSearched: boolean;
  safeCurrentPage: number;
  totalSearchPages: number;
  onPagePrev: () => void;
  onPageNext: () => void;
  onOpenPreview: (upload: RecentUpload) => void;
  formatRecentUploadTime: (createdAt: number) => string;
}

function fallbackThumbDataUri(label = "NO PREVIEW"): string {
  const safeLabel = label.replace(/[<>]/g, "").slice(0, 24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141b2a"/><stop offset="100%" stop-color="#0d111b"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><rect x="16" y="16" width="288" height="208" rx="6" fill="none" stroke="#334155" stroke-width="2"/><text x="160" y="122" fill="#94a3b8" font-family="Montserrat, sans-serif" font-size="16" text-anchor="middle">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function SearchPanel({
  plate,
  uploadProvider,
  isSearching,
  searchQuery,
  setSearchQuery,
  onSearch,
  onResetSearch,
  displayedUploads,
  pagedUploads,
  hasSearched,
  safeCurrentPage,
  totalSearchPages,
  onPagePrev,
  onPageNext,
  onOpenPreview,
  formatRecentUploadTime,
}: SearchPanelProps) {
  const [brokenSearchThumbs, setBrokenSearchThumbs] = useState<
    Record<string, true>
  >({});
  const searchResultsListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBrokenSearchThumbs({});
  }, [displayedUploads]);

  useEffect(() => {
    if (!searchResultsListRef.current) {
      return;
    }

    searchResultsListRef.current.scrollTo({ top: 0, behavior: "auto" });
  }, [safeCurrentPage]);

  if (uploadProvider !== "primary") {
    return null;
  }

  return (
    <div className="section-block search-tools">
      <h2>ТЪРСЕНЕ НА КАЧВАНИЯ</h2>
      <div className="search-row">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearch();
            }
          }}
          placeholder={`*${plate}*`}
          disabled={isSearching}
        />
        <button type="button" onClick={onSearch} disabled={isSearching}>
          {isSearching ? "Търсене..." : "Търси"}
        </button>
        <button
          type="button"
          className="search-reset-btn"
          onClick={onResetSearch}
        >
          Reset
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
                  <button
                    type="button"
                    className="search-result-thumb"
                    title="Preview"
                    onClick={() => onOpenPreview(item)}
                  >
                    <img
                      src={
                        brokenSearchThumbs[item.url]
                          ? fallbackThumbDataUri()
                          : item.url
                      }
                      alt="Търсене dyno report"
                      loading="lazy"
                      onError={() => {
                        setBrokenSearchThumbs((prev) =>
                          prev[item.url] ? prev : { ...prev, [item.url]: true },
                        );
                      }}
                    />
                  </button>
                  <div className="search-result-meta">
                    <p>{item.fileName || "unnamed-file"}</p>
                    <span>
                      provider: {item.provider === "imgbb" ? "imgbb" : "main"}
                    </span>
                    <span>{formatRecentUploadTime(item.createdAt)}</span>
                  </div>
                  <div className="search-result-actions">
                    <button
                      type="button"
                      title="Preview"
                      onClick={() => onOpenPreview(item)}
                    >
                      <Eye aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="search-pagination">
              <button
                type="button"
                onClick={onPagePrev}
                disabled={safeCurrentPage <= 1}
              >
                Prev
              </button>
              <button
                type="button"
                onClick={onPageNext}
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
  );
}
