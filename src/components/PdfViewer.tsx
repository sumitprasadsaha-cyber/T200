import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  RefreshCw,
  X,
  Loader2,
  Download,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2
} from "lucide-react";
import {
  openPdfWithNativeViewer,
  isImageFile,
  isNativePlatform,
  NoteViewerState,
  USER_FRIENDLY_NOTE_ERROR,
  USER_FRIENDLY_NOTE_UNAVAILABLE
} from "../lib/nativePdfService";
import { recordNoteOpenedOrDownloaded } from "../utils/chapterProgressHelper";

interface PdfViewerProps {
  url: string;
  title: string;
  onClose: () => void;
  noteId?: string;
  storagePath?: string;
  bucket?: string;
  fileName?: string;
  mimeType?: string;
  fileType?: "pdf" | "image" | string;
  studentId?: string;
  subject?: string;
}

export default function PdfViewer({
  url,
  title,
  onClose,
  noteId,
  storagePath,
  bucket,
  fileName,
  mimeType,
  fileType,
  studentId,
  subject
}: PdfViewerProps) {
  const [status, setStatus] = useState<NoteViewerState>("downloading");
  const [progress, setProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("Connecting to Cloudflare R2…");
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isImg = isImageFile(fileName, url || storagePath, mimeType, fileType);
  const isExecutingRef = useRef(false);
  const isMountedRef = useRef(true);
  const hasLaunchedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (previewBlobUrl && previewBlobUrl.startsWith("blob:")) {
        // Blob URL will be cleaned up by service cache or garbage collector
      }
    };
  }, [previewBlobUrl]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenPdf = useCallback(async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
      if (!isMountedRef.current) return;
      setStatus("downloading");
      setError(null);
      setProgress(null);
      setStatusText("Connecting to Cloudflare R2…");

      const result = await openPdfWithNativeViewer({
        url,
        title,
        storagePath,
        bucket,
        noteId,
        fileName,
        mimeType,
        fileType,
        onProgress: (percent, text) => {
          if (!isMountedRef.current) return;
          setProgress(percent);
          setStatusText(text);
          if (percent !== null && percent >= 90) {
            setStatus("opening");
          } else {
            setStatus("downloading");
          }
        }
      });

      if (!isMountedRef.current) return;

      // Record note as opened/downloaded for student progress tracking
      if (noteId && studentId) {
        recordNoteOpenedOrDownloaded(studentId, subject || "", noteId);
      }

      const isNative = isNativePlatform();

      if (isNative) {
        // On native Android app, Native FileOpener intent takes over
        setStatus("opened");
        setProgress(100);
        setTimeout(() => {
          if (isMountedRef.current) {
            onCloseRef.current();
          }
        }, 500);
      } else {
        // On Web browser, display inline high-fidelity preview
        const resolvedUrl = result.objectUrl || (result.blob ? URL.createObjectURL(result.blob) : url);
        setPreviewBlobUrl(resolvedUrl);
        setStatus("opened");
        setProgress(100);
      }
    } catch (err: any) {
      console.error("[PdfViewer Modal] Error opening note:", err);
      if (!isMountedRef.current) return;
      setStatus("error");
      const msg = err?.message || USER_FRIENDLY_NOTE_ERROR;
      setError(msg);
    } finally {
      isExecutingRef.current = false;
    }
  }, [url, title, storagePath, bucket, noteId, fileName, mimeType, fileType, studentId, subject]);

  useEffect(() => {
    if (hasLaunchedRef.current && retryTrigger === 0) return;
    hasLaunchedRef.current = true;
    handleOpenPdf();
  }, [handleOpenPdf, retryTrigger]);

  const handleRetry = () => {
    if (status === "downloading" || status === "opening") return;
    setStatus("idle");
    setError(null);
    setPreviewBlobUrl(null);
    hasLaunchedRef.current = false;
    setRetryTrigger((prev) => prev + 1);
  };

  const handleDownload = () => {
    if (!previewBlobUrl && !url) return;
    const downloadUrl = previewBlobUrl || url;
    const cleanFilename =
      fileName ||
      `${title.replace(/[^a-zA-Z0-9_\-\s]/g, "_").trim()}.${isImg ? "jpg" : "pdf"}`;

    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = cleanFilename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (noteId && studentId) {
      recordNoteOpenedOrDownloaded(studentId, subject || "", noteId);
    }
  };

  const handleOpenExternal = () => {
    if (!previewBlobUrl && !url) return;
    window.open(previewBlobUrl || url, "_blank", "noopener,noreferrer");
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const isUnavailableError = error === USER_FRIENDLY_NOTE_UNAVAILABLE;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn select-none"
    >
      <div
        className={`relative bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-white transition-all duration-200 ${
          status === "opened" && !isNativePlatform()
            ? isFullscreen
              ? "w-full h-full rounded-none"
              : "w-full max-w-5xl h-[90vh]"
            : "w-full max-w-md p-6 items-center text-center"
        }`}
      >
        {/* Header Bar */}
        <div className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-1.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-lg shrink-0">
              {isImg ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </div>
            <div className="min-w-0 text-left">
              <h3 className="text-sm font-semibold text-slate-100 truncate">{title}</h3>
              <p className="text-[11px] text-slate-400 truncate">
                {isImg ? "Image / Diagram Note" : "PDF Study Document"} • Cloudflare R2
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {status === "opened" && !isNativePlatform() && (
              <>
                {isImg && (
                  <>
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-mono text-slate-400 px-1">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition active:scale-95"
                  title="Download File"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenExternal}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                  title="Open in New Tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
              title="Close Viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 w-full min-h-0 relative overflow-hidden flex items-center justify-center bg-slate-950/60">
          {/* Loading / Downloading Progress State */}
          {(status === "downloading" || status === "opening") && (
            <div className="w-full max-w-sm px-6 py-10 flex flex-col items-center gap-4 text-center">
              <div className="p-4 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-2xl animate-pulse">
                {isImg ? <ImageIcon className="w-10 h-10" /> : <FileText className="w-10 h-10" />}
              </div>

              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700/80 relative">
                {progress !== null ? (
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                ) : (
                  <div className="h-full bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 w-1/2 rounded-full animate-[indeterminate_1.5s_infinite_linear]" />
                )}
              </div>

              <div className="flex items-center justify-between w-full px-1 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <span className="font-semibold text-slate-200">{statusText}</span>
                </div>
                {progress !== null && <span className="font-mono text-blue-400 font-bold">{progress}%</span>}
              </div>
            </div>
          )}

          {/* Web Preview: Render PDF in embedded frame or Image */}
          {status === "opened" && !isNativePlatform() && previewBlobUrl && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-2 bg-slate-950">
              {isImg ? (
                <div
                  className="transition-transform duration-150 flex items-center justify-center min-h-full min-w-full"
                  style={{ transform: `scale(${zoomLevel})` }}
                >
                  <img
                    src={previewBlobUrl}
                    alt={title}
                    className="max-h-[82vh] w-auto max-w-full object-contain rounded-lg shadow-xl"
                  />
                </div>
              ) : (
                <iframe
                  src={previewBlobUrl}
                  className="w-full h-full rounded-lg border-0 bg-slate-900 shadow-inner"
                  title={title}
                />
              )}
            </div>
          )}

          {/* Error State */}
          {status === "error" && error && (
            <div className="w-full max-w-md p-6 flex flex-col items-center gap-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-300 animate-fadeIn m-4 text-center">
              <div className="p-3 bg-rose-500/20 rounded-full text-rose-400">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-bold text-slate-100">Unable to Open Note</h4>
              <p className="text-xs text-rose-300 leading-relaxed max-w-sm">{error}</p>

              <div className="flex items-center gap-2 mt-3 w-full">
                {!isUnavailableError && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md cursor-pointer transition active:scale-95"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-5 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl cursor-pointer transition ${
                    isUnavailableError ? "w-full" : ""
                  }`}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
