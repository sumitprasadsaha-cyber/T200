import React, { useEffect, useState, useCallback, useRef } from "react";
import { FileText, Image as ImageIcon, AlertTriangle, RefreshCw, X, CheckCircle2 } from "lucide-react";
import { openPdfWithNativeViewer, isImageFile, NoteViewerState } from "../lib/nativePdfService";
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
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Preparing Note…");
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);

  const isImg = isImageFile(fileName, url, mimeType, fileType);
  const isExecutingRef = useRef(false);
  const isMountedRef = useRef(true);
  const hasLaunchedRef = useRef(false);
  const closeTimerRef = useRef<any>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleOpenPdf = useCallback(async () => {
    // Single tap protection: do not allow duplicate parallel executions
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
      if (!isMountedRef.current) return;
      setStatus("downloading");
      setError(null);
      setProgress(0);
      setStatusText("Preparing Note…");

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
          if (percent >= 80) {
            setStatus("opening");
          } else {
            setStatus("downloading");
          }
        }
      });

      if (!isMountedRef.current) return;

      // Record note as opened/downloaded for progress tracking
      if (noteId && studentId) {
        recordNoteOpenedOrDownloaded(studentId, subject || "", noteId);
      }

      if (result.isNative) {
        // Native device opened in system viewer -> dismiss modal immediately
        setStatus("opened");
        setProgress(100);
        onCloseRef.current();
      } else if (result.objectUrl) {
        // Web / browser environment -> display in-app viewer
        setWebPreviewUrl(result.objectUrl);
        setStatus("opened");
        setProgress(100);
      } else {
        setStatus("opened");
        setProgress(100);
        onCloseRef.current();
      }
    } catch (err: any) {
      console.error("[PdfViewer Modal] Error opening document:", err);
      if (!isMountedRef.current) return;
      setStatus("error");
      setError("Unable to open note. Please try again.");
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
    hasLaunchedRef.current = false;
    setRetryTrigger((prev) => prev + 1);
  };

  const handleClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn select-none">
      <div className={`relative w-full ${webPreviewUrl ? "max-w-4xl max-h-[90vh]" : "max-w-md"} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 text-white flex flex-col items-center text-center transition-all`}>
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer z-10"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header (when not showing large web preview) */}
        {!webPreviewUrl && (
          <>
            {/* Icon Badge */}
            <div className="p-3.5 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-2xl mb-4">
              {isImg ? <ImageIcon className="w-8 h-8" /> : <FileText className="w-8 h-8" />}
            </div>

            {/* Document Title */}
            <h3 className="text-base font-bold text-slate-100 truncate max-w-full px-2 mb-1">
              {title}
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              {isImg ? "Study Space Photo" : "Study Space Notes"}
            </p>
          </>
        )}

        {/* Web In-App Viewer */}
        {status === "opened" && webPreviewUrl && (
          <div className="w-full flex flex-col items-center gap-3 pt-2">
            <div className="flex items-center gap-2 self-start mb-2 px-1">
              {isImg ? <ImageIcon className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
              <span className="text-xs font-bold text-slate-200 truncate">{title}</span>
            </div>
            {isImg ? (
              <img
                src={webPreviewUrl}
                alt={title}
                className="max-h-[70vh] w-auto max-w-full rounded-xl object-contain border border-slate-800 shadow-inner"
              />
            ) : (
              <iframe
                src={webPreviewUrl}
                title={title}
                className="w-full h-[70vh] rounded-xl border border-slate-800 shadow-inner bg-white"
              />
            )}
          </div>
        )}

        {/* Loading / Downloading / Opening Progress State */}
        {(status === "downloading" || status === "opening") && (
          <div className="w-full flex flex-col items-center gap-3">
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700/80">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-slate-300 animate-pulse">
              {statusText}
            </span>
          </div>
        )}

        {/* Success / Opened State for non-webPreview */}
        {status === "opened" && !webPreviewUrl && (
          <div className="flex flex-col items-center gap-2 text-emerald-400 animate-fadeIn">
            <CheckCircle2 className="w-7 h-7" />
            <span className="text-xs font-bold text-slate-200">
              {isImg ? "Photo Opened" : "Notes Opened"}
            </span>
          </div>
        )}

        {/* Error State with Retry button */}
        {status === "error" && error && (
          <div className="w-full flex flex-col items-center gap-3 bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl text-rose-400 mt-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="text-xs font-bold text-left">{error}</span>
            </div>

            <div className="flex items-center gap-2 mt-2 w-full">
              <button
                type="button"
                onClick={handleRetry}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md cursor-pointer transition active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl cursor-pointer transition"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
