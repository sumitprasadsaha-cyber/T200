import React, { useState } from "react";
import { X, CheckCircle2, FileText, Check } from "lucide-react";
import {
  PROGRESS_STATUS_MAPPING,
  getStatusConfig,
  normalizeStatusLabel
} from "../utils/chapterProgressHelper";
import { ChapterNote, ChapterProgressData } from "../types";

interface ChapterProgressBottomSheetProps {
  note: ChapterNote;
  subject: string;
  initialProgress?: ChapterProgressData | null;
  onClose: () => void;
  onSave: (status: string, remarks: string) => Promise<void> | void;
}

export default function ChapterProgressBottomSheet({
  note,
  subject,
  initialProgress,
  onClose,
  onSave
}: ChapterProgressBottomSheetProps) {
  const activeNoteKey = `${subject}_${note.id}`;
  const prevNoteKeyRef = React.useRef(activeNoteKey);

  const initialStatus = initialProgress?.selectedStatus
    ? normalizeStatusLabel(initialProgress.selectedStatus)
    : "Not Started";

  const [selectedStatus, setSelectedStatus] = useState<string>(initialStatus);
  const [remarks, setRemarks] = useState<string>(
    initialProgress?.remarks || note.remark || ""
  );
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (prevNoteKeyRef.current !== activeNoteKey) {
      prevNoteKeyRef.current = activeNoteKey;
      const currentStatus = initialProgress?.selectedStatus
        ? normalizeStatusLabel(initialProgress.selectedStatus)
        : "Not Started";
      setSelectedStatus(currentStatus);
      setRemarks(initialProgress?.remarks || note.remark || "");
    }
  }, [activeNoteKey, initialProgress, note.remark]);

  const currentConfig = getStatusConfig(selectedStatus);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(selectedStatus, remarks);
    } catch (err) {
      console.error("Failed to save progress:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
      id="chapter-progress-overlay"
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden animate-slideUp sm:animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
        id="chapter-progress-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
              Chapter {note.chapterNo} • {subject}
            </span>
            <h3 className="text-base font-extrabold text-slate-850 dark:text-slate-100">
              Chapter Progress
            </h3>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
              Update your preparation for this chapter.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 scrollbar-thin">
          {/* Active Chapter Name Banner */}
          <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-2xl border border-blue-100/80 dark:border-blue-900/40 flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                {note.chapterName}
              </h4>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                  Auto Progress: {currentConfig.percent}%
                </span>
              </div>
            </div>
          </div>

          {/* Radio Buttons for Status */}
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Select Progress Status
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PROGRESS_STATUS_MAPPING.map((item) => {
                const isSelected = selectedStatus === item.label;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setSelectedStatus(item.label)}
                    className={`flex items-center justify-between p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-blue-50/90 dark:bg-blue-950/60 border-blue-500 shadow-xs text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/30"
                        : "bg-slate-50/50 dark:bg-slate-950/30 border-slate-200/70 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          isSelected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className="text-xs font-bold truncate">
                        {item.emoji} {item.label}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 ml-1 ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {item.percent}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Student Remarks Textarea */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Remarks (Optional)
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="e.g. Need revision of Constitutional Articles."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-hidden focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2 active:scale-95 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Progress</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
