import React, { useState, useMemo, useRef, useEffect } from "react";
import { 
  ArrowLeft, 
  Plus, 
  FileText, 
  Image as ImageIcon,
  Trash2, 
  BookOpen, 
  Upload,
  Eye,
  X,
  Pencil,
  Search,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  Users,
  Globe,
  Lock,
  Sparkles,
  Trophy,
  CheckCircle2,
  FileCheck,
  Award,
  BarChart2,
  Calendar,
  AlertCircle
} from "lucide-react";
import { ChapterNote, Student, TestAttemptRecord } from "../types";
import { uploadPdfToStorage, downloadFileFromStorage, sanitizeStoragePath, getBucketName } from "../lib/storageService";
import PdfViewer from "./PdfViewer";
import { isImageFile } from "../lib/nativePdfService";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import SelectStudentsModal from "./SelectStudentsModal";
import { groupAndSortChapterNotes, getFormattedTopicLabel, isFileNameRedundant } from "../utils/chapterNotesHelper";
import { isNoteAccessibleToStudent, filterNotesForStudent } from "../utils/noteAccessHelper";
import StudentPracticeTestModal from "./StudentPracticeTestModal";
import AdminPracticeTestModal from "./AdminPracticeTestModal";
import { getFullChapterQuestions, getTopicPracticeTestSync, deleteTopicPracticeTest, fetchAllPracticeTestsFromSupabase, getScoreButtonStyles } from "../lib/practiceTestService";
import { getAllTestAttempts } from "../utils/assessmentParser";
import { fetchStudentTestAttemptsFromSupabase } from "../lib/testScorePersistence";

export interface TopicTestStats {
  bestScore: number;
  totalQuestions: number;
  bestPercentage: number;
  latestScore: number;
  latestPercentage: number;
  latestTotalQuestions: number;
  averageScore: number;
  attemptCount: number;
  lastAttemptDate: string;
  bestAttempt: TestAttemptRecord;
  latestAttempt: TestAttemptRecord;
}

export function getTopicTestStats(
  allAttempts: TestAttemptRecord[],
  studentIdentifier: string | undefined,
  studentName: string | undefined,
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicLabel: string
): TopicTestStats | null {
  const normClass = classGrade.toLowerCase().trim();
  const normSubj = subject.toLowerCase().trim();
  const normTopic = topicLabel.toLowerCase().trim();

  const topicAttempts = allAttempts.filter((a) => {
    const matchesStudent =
      (!studentIdentifier && !studentName) ||
      (studentIdentifier && a.studentId === studentIdentifier) ||
      (studentName && a.studentName.toLowerCase().trim() === studentName.toLowerCase().trim());
    if (!matchesStudent) return false;
    if (a.testType !== "topic") return false;
    if (a.classGrade.toLowerCase().trim() !== normClass) return false;
    if (a.subject.toLowerCase().trim() !== normSubj) return false;
    if (a.chapterNo !== chapterNo) return false;
    const aNorm = a.topicName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const targetNorm = normTopic.replace(/[^a-z0-9]/g, "");
    return aNorm === targetNorm || aNorm.includes(targetNorm) || targetNorm.includes(aNorm);
  });

  if (topicAttempts.length === 0) return null;

  const attemptCount = topicAttempts.length;
  const latestAttempt = topicAttempts[topicAttempts.length - 1];

  let bestAttempt = topicAttempts[0];
  let bestRatio = bestAttempt.totalQuestions > 0 ? bestAttempt.score / bestAttempt.totalQuestions : 0;

  for (let i = 1; i < topicAttempts.length; i++) {
    const curr = topicAttempts[i];
    const currRatio = curr.totalQuestions > 0 ? curr.score / curr.totalQuestions : 0;
    if (currRatio > bestRatio || (currRatio === bestRatio && curr.score > bestAttempt.score)) {
      bestAttempt = curr;
      bestRatio = currRatio;
    }
  }

  const bestScore = bestAttempt.score;
  const totalQuestions = bestAttempt.totalQuestions || 1;
  const bestPercentage = Math.round(bestRatio * 100);

  const sumScores = topicAttempts.reduce((acc, a) => acc + a.score, 0);
  const averageScore = Number((sumScores / attemptCount).toFixed(1));

  return {
    bestScore,
    totalQuestions,
    bestPercentage,
    latestScore: latestAttempt.score,
    latestPercentage: latestAttempt.percentage,
    latestTotalQuestions: latestAttempt.totalQuestions || 1,
    averageScore,
    attemptCount,
    lastAttemptDate: latestAttempt.date,
    bestAttempt,
    latestAttempt
  };
}

export function getScoreBadgeColors(percentage: number) {
  if (percentage >= 90) {
    return {
      badge: "bg-emerald-50 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-700/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200",
      text: "text-emerald-800 dark:text-emerald-200",
      subtext: "text-emerald-600 dark:text-emerald-400"
    };
  } else if (percentage >= 75) {
    return {
      badge: "bg-blue-50 dark:bg-blue-950/80 border-blue-300 dark:border-blue-700/80 hover:bg-blue-100 dark:hover:bg-blue-900/80 text-blue-800 dark:text-blue-200",
      text: "text-blue-800 dark:text-blue-200",
      subtext: "text-blue-600 dark:text-blue-400"
    };
  } else if (percentage >= 50) {
    return {
      badge: "bg-amber-50 dark:bg-amber-950/80 border-amber-300 dark:border-amber-700/80 hover:bg-amber-100 dark:hover:bg-amber-900/80 text-amber-800 dark:text-amber-200",
      text: "text-amber-800 dark:text-amber-200",
      subtext: "text-amber-600 dark:text-amber-400"
    };
  } else {
    return {
      badge: "bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-700/80 hover:bg-rose-100 dark:hover:bg-rose-900/80 text-rose-800 dark:text-rose-200",
      text: "text-rose-800 dark:text-rose-200",
      subtext: "text-rose-600 dark:text-rose-400"
    };
  }
}

interface SubjectNotesProps {
  subject: string;
  studentName: string;
  studentId?: string;
  classGrade?: string;
  notes: ChapterNote[];
  onBack: () => void;
  onAddNote: (
    chapterNo: number,
    chapterName: string,
    pdfUrl: string,
    pdfFileName: string,
    accessType?: "all" | "selected",
    allowedStudentIds?: string[]
  ) => void;
  onEditNote?: (noteId: string, newChapterNo: number, newChapterName: string) => Promise<void> | void;
  onDeleteNote: (noteId: string) => void;
  onUpdateNoteAccess?: (
    subject: string,
    noteId: string,
    accessType: "all" | "selected",
    allowedStudentIds: string[]
  ) => Promise<void> | void;
  isAdmin?: boolean;
  enrolledSubjects?: string[];
  onSelectSubject?: (subject: string) => void;
  students?: Student[];
  studentServiceStatus?: string;
}

export default function SubjectNotes({
  subject,
  studentName,
  studentId,
  classGrade,
  notes,
  onBack,
  onAddNote,
  onEditNote,
  onDeleteNote,
  onUpdateNoteAccess,
  isAdmin = true,
  enrolledSubjects = [],
  onSelectSubject,
  students = [],
  studentServiceStatus
}: SubjectNotesProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [chapterNo, setChapterNo] = useState<number | "">("");
  const [chapterName, setChapterName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Student Access Control state for Upload Form
  const [uploadAccessType, setUploadAccessType] = useState<"all" | "selected">("all");
  const [uploadAllowedStudentIds, setUploadAllowedStudentIds] = useState<string[]>([]);
  const [isUploadStudentModalOpen, setIsUploadStudentModalOpen] = useState(false);

  // Manage Access state for existing chapter notes
  const [managingAccessNote, setManagingAccessNote] = useState<ChapterNote | null>(null);
  const [manageAccessType, setManageAccessType] = useState<"all" | "selected">("all");
  const [manageAllowedStudentIds, setManageAllowedStudentIds] = useState<string[]>([]);
  const [isManageAccessModalOpen, setIsManageAccessModalOpen] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Assessment Test Modal States
  const [studentTestTarget, setStudentTestTarget] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    testType: "topic" | "full_chapter";
  } | null>(null);

  const [adminTestTarget, setAdminTestTarget] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
  } | null>(null);

  // Topic Test Stats & Realtime Sync State
  const [attemptsVersion, setAttemptsVersion] = useState(0);
  const [selectedStatsModal, setSelectedStatsModal] = useState<{
    topicName: string;
    chapterNo: number;
    chapterName: string;
    stats: TopicTestStats;
  } | null>(null);

  useEffect(() => {
    fetchAllPracticeTestsFromSupabase();
    if (studentId) {
      fetchStudentTestAttemptsFromSupabase(studentId, studentName);
    }

    const handleUpdate = () => {
      if (studentId) {
        fetchStudentTestAttemptsFromSupabase(studentId, studentName);
      }
      setAttemptsVersion((prev) => prev + 1);
    };
    window.addEventListener("test-attempts-updated", handleUpdate);
    window.addEventListener("practice-tests-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("test-attempts-updated", handleUpdate);
      window.removeEventListener("practice-tests-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [subject, classGrade, studentId]);

  const allAttempts = useMemo(() => {
    return getAllTestAttempts();
  }, [attemptsVersion]);

  // Edit Chapter Modal state
  const [editingNote, setEditingNote] = useState<ChapterNote | null>(null);
  const [editChapterNo, setEditChapterNo] = useState<number | "">("");
  const [editChapterName, setEditChapterName] = useState("");
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // PDF / Image Preview state
  const [activePreviewPdf, setActivePreviewPdf] = useState<{
    url: string;
    title: string;
    noteId?: string;
    storagePath?: string;
    bucket?: string;
    fileName?: string;
    mimeType?: string;
    fileType?: "pdf" | "image" | string;
  } | null>(null);

  // Delete Confirmation Modal state
  const [deleteModalNoteId, setDeleteModalNoteId] = useState<string | null>(null);
  const [deleteGroupModalNotes, setDeleteGroupModalNotes] = useState<any[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Collapsible chapter state
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});

  const toggleChapterExpand = (chapterNo: number) => {
    setExpandedChapters((prev) => ({
      ...prev,
      [chapterNo]: !prev[chapterNo]
    }));
  };

  // 1. Filter notes based on student permissions first
  const accessibleNotes = useMemo(() => {
    return filterNotesForStudent(notes, studentId, isAdmin);
  }, [notes, studentId, isAdmin]);

  // 2. Filter notes by Subject, Chapter Number, Chapter Name, or PDF file name
  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return accessibleNotes;
    return accessibleNotes.filter((note) => {
      const matchSubject = subject.toLowerCase().includes(query);
      const matchChNo = `chapter ${note.chapterNo}`.toLowerCase().includes(query) || `${note.chapterNo}`.includes(query);
      const matchChName = (note.chapterName || "").toLowerCase().includes(query);
      const matchFileName = (note.pdfFileName || "").toLowerCase().includes(query);
      return matchSubject || matchChNo || matchChName || matchFileName;
    });
  }, [accessibleNotes, searchQuery, subject]);

  // Grouping PDFs under their respective chapter and sorting chapters numerically
  const groupedChapterNotes = useMemo(() => {
    return groupAndSortChapterNotes(filteredNotes);
  }, [filteredNotes]);

  const formatDate = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  const targetStud = students?.find((s) => s.id === studentId || (s.name && studentName && s.name.toLowerCase() === studentName.toLowerCase()));
  const currentServiceStatus = (
    studentServiceStatus ||
    targetStud?.serviceStatus ||
    targetStud?.service_status ||
    "active"
  ).toLowerCase();

  const handlePreviewPdf = (note: ChapterNote) => {
    if (!isAdmin) {
      if (currentServiceStatus === "paused") {
        alert("Your learning services are temporarily paused. Please contact the academy for assistance.");
        return;
      }
      if (currentServiceStatus === "ended") {
        alert("Your academy services have ended. Please contact the administrator if you believe this is an error.");
        return;
      }
    }

    // Security check: verify student permission before previewing
    if (!isAdmin && !isNoteAccessibleToStudent(note, studentId, false)) {
      alert("Access Denied: You do not have permission to view this chapter note.");
      return;
    }

    if (!note.pdfUrl) return;
    let url = note.pdfUrl;
    let storagePath = note.storagePath;
    let bucket = note.bucket;
    if (url.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(url);
        url = parsed.storagePath || parsed.downloadUrl || parsed.url || url;
        storagePath = parsed.storagePath || storagePath;
        bucket = parsed.bucket || bucket;
      } catch (e) {
        // ignore
      }
    }
    setActivePreviewPdf({
      url,
      title: `Chapter ${note.chapterNo} - ${note.chapterName}`,
      noteId: note.id,
      storagePath: storagePath || url,
      bucket: bucket,
      fileName: note.pdfFileName || note.fileName,
      mimeType: note.mimeType,
      fileType: note.fileType
    });
  };

  const handlePdfUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const isImg = file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(file.name);
      if (!isPdf && !isImg) {
        setError("Please select a valid PDF document or Image file.");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setError("File size exceeds the 50MB limit.");
        return;
      }
      setPdfFile(file);
      setPdfName(file.name);
      setError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chapterNo || Number(chapterNo) <= 0) {
      setError("Please specify a valid Chapter Number");
      return;
    }
    if (!chapterName.trim()) {
      setError("Please specify a Chapter Name");
      return;
    }
    if (!pdfFile) {
      setError("Please upload a PDF notes file");
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setError("");

      const cleanPart = chapterName.trim();
      const isPdf = pdfFile.type === "application/pdf" || pdfFile.name.toLowerCase().endsWith(".pdf");
      const isImg = pdfFile.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(pdfFile.name);
      let ext = pdfFile.name.includes(".") ? pdfFile.name.split(".").pop() : (isImg ? "jpg" : "pdf");
      if (!ext) ext = isImg ? "jpg" : "pdf";

      let targetFileName = pdfName || pdfFile.name;
      if (cleanPart) {
        const hasExtension = cleanPart.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
        targetFileName = hasExtension ? cleanPart : `${cleanPart}.${ext}`;
      }

      const uploadedUrl = await uploadPdfToStorage(
        studentId || "sandbox",
        subject,
        targetFileName,
        pdfFile,
        (progress) => setUploadProgress(progress)
      );

      const finalAllowedIds = uploadAccessType === "selected" ? uploadAllowedStudentIds : [];

      onAddNote(
        Number(chapterNo),
        chapterName.trim(),
        uploadedUrl,
        targetFileName,
        uploadAccessType,
        finalAllowedIds
      );

      // Reset form
      setChapterNo("");
      setChapterName("");
      setPdfFile(null);
      setPdfName("");
      setUploadAccessType("all");
      setUploadAllowedStudentIds([]);
      setIsAdding(false);
      setError("");
    } catch (err: any) {
      console.error(err);
      setError("Unable to upload notes. Please try again.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleCancel = () => {
    setChapterNo("");
    setChapterName("");
    setPdfFile(null);
    setPdfName("");
    setUploadAccessType("all");
    setUploadAllowedStudentIds([]);
    setIsAdding(false);
    setError("");
    setUploadProgress(0);
  };

  const handleOpenManageAccess = (note: ChapterNote) => {
    setManagingAccessNote(note);
    setManageAccessType(note.accessType || "all");
    const currentAllowed = note.allowedStudentIds && note.allowedStudentIds.length > 0
      ? note.allowedStudentIds
      : students.map((s) => s.id);
    setManageAllowedStudentIds(currentAllowed);
    setIsManageAccessModalOpen(true);
  };

  const handleSaveManageAccess = async (selectedIds: string[]) => {
    if (!managingAccessNote) return;
    
    if (onUpdateNoteAccess) {
      await onUpdateNoteAccess(
        subject,
        managingAccessNote.id,
        manageAccessType,
        manageAccessType === "selected" ? selectedIds : []
      );
    }
    
    setManagingAccessNote(null);
    setIsManageAccessModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-5 pb-24 animate-fadeIn" id="subject-notes-view">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4" id="notes-header">
        <button
          onClick={onBack}
          className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl transition-all cursor-pointer"
          id="btn-back-to-details"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">
            {studentName} • Subject Notes
          </span>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 -mt-0.5">
            {subject}
          </h1>
        </div>
      </div>

      {!isAdmin && currentServiceStatus === "paused" && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-300 shadow-xs mb-1" id="subject-notes-paused-banner">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs sm:text-sm font-bold leading-relaxed">
            Your learning services are temporarily paused. Please contact the academy for assistance.
          </p>
        </div>
      )}
      {!isAdmin && currentServiceStatus === "ended" && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 shadow-xs mb-1" id="subject-notes-ended-banner">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="text-xs sm:text-sm font-bold leading-relaxed">
            Your academy services have ended. Please contact the administrator if you believe this is an error.
          </p>
        </div>
      )}

      {/* Two-Panel Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start" id="notes-two-panel-container">
        
        {/* Left Panel: Subject Picker */}
        {enrolledSubjects && enrolledSubjects.length > 0 && (
          <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 shrink-0 scrollbar-none" id="notes-left-subject-panel">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1 hidden md:block">
              Subjects
            </span>
            {enrolledSubjects.map((sub) => {
              const isActive = sub === subject;
              return (
                <button
                  key={sub}
                  onClick={() => onSelectSubject && onSelectSubject(sub)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left flex items-center justify-between shrink-0 cursor-pointer ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800"
                  }`}
                >
                  <span className="truncate">{sub}</span>
                  {isActive && <ChevronRight className="w-4 h-4 hidden md:block shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Right Panel: Notes List & Controls */}
        <div className="flex flex-col gap-4 min-w-0" id="notes-right-content-panel">
          
          {/* Top Control Bar: Search */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs" id="notes-control-bar">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search chapters by number, name or PDF file..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Chapter Notes List */}
          <div className="flex flex-col gap-3.5" id="notes-list-container">
            {groupedChapterNotes.length > 0 ? (
              groupedChapterNotes.map((group) => {
                if (group.notes.length === 1) {
                  const note = group.notes[0];
                  return (
                    <div
                      key={`chapter-single-${group.chapterNo}-${note.id}`}
                      onClick={() => handlePreviewPdf(note)}
                      className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-blue-300 dark:hover:border-blue-800 transition-all cursor-pointer group"
                      id={`note-card-${note.id}`}
                    >
                      {/* Chapter details */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <BookOpen className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <h3 className="flex items-start gap-1.5 font-extrabold text-slate-850 dark:text-slate-100 text-sm min-w-0">
                            <span className="shrink-0">Topic {group.chapterNo} –</span>
                            <span className="flex-1 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                              {group.chapterName}
                            </span>
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {note.pdfFileName && (
                              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 break-words">
                                {note.pdfFileName}
                              </span>
                            )}
                            {note.createdAt && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                • {formatDate(note.createdAt)}
                              </span>
                            )}
                            {isAdmin && (
                              <span
                                className={`text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 ${
                                  note.accessType === "selected"
                                    ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900"
                                    : "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900"
                                }`}
                              >
                                {note.accessType === "selected" ? (
                                  <>
                                    <Users className="w-2.5 h-2.5" />
                                    <span>{note.allowedStudentIds?.length || 0} Students</span>
                                  </>
                                ) : (
                                  <>
                                    <Globe className="w-2.5 h-2.5" />
                                    <span>All Students</span>
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
                        {/* Practice Test Button & Score */}
                        {(() => {
                          const topicLabel = getFormattedTopicLabel(note) || `Topic ${group.chapterNo}`;
                          const matchedStud = students.find((s) => s.id === studentId || s.name === studentName);
                          const noteClass = note.classGrade || classGrade || matchedStud?.classGrade || "Class 10";
                          const noteSubj = note.subject || subject;
                          const topicTest = getTopicPracticeTestSync(noteClass, noteSubj, group.chapterNo, topicLabel);
                          const hasTest = !!(topicTest && topicTest.questions && topicTest.questions.length > 0);

                          const studentIdentifier = studentId || studentName;
                          const stats = getTopicTestStats(
                            allAttempts,
                            studentIdentifier,
                            studentName,
                            noteClass,
                            subject,
                            group.chapterNo,
                            topicLabel
                          );

                          if (!isAdmin && !hasTest) return null;

                          const isAttempted = !!(stats && stats.attemptCount > 0);
                          const btnStyles = getScoreButtonStyles(isAttempted, stats?.bestPercentage);

                          return (
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(hasTest || isAdmin) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isAdmin) {
                                      setAdminTestTarget({
                                        classGrade: noteClass,
                                        subject,
                                        chapterNo: group.chapterNo,
                                        chapterName: group.chapterName,
                                        topicName: topicLabel
                                      });
                                    } else {
                                      setStudentTestTarget({
                                        classGrade: noteClass,
                                        subject,
                                        chapterNo: group.chapterNo,
                                        chapterName: group.chapterName,
                                        topicName: topicLabel,
                                        testType: "topic"
                                      });
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer shadow-2xs shrink-0 min-h-[40px] flex items-center gap-2 ${btnStyles.container}`}
                                  title={
                                    isAttempted && stats
                                      ? `Highest Score: ${stats.bestScore}/${stats.totalQuestions}`
                                      : "Practice Test for this Topic"
                                  }
                                >
                                  <FileCheck className={`w-4 h-4 shrink-0 ${btnStyles.icon}`} />
                                  {isAttempted && stats ? (
                                    <div className="flex flex-col items-center justify-center text-center leading-none">
                                      <span className={`text-xs sm:text-sm font-black ${btnStyles.scoreText}`}>
                                        {stats.bestScore}/{stats.totalQuestions}
                                      </span>
                                      <span className={`text-[10px] sm:text-[11px] font-bold mt-0.5 ${btnStyles.labelText}`}>
                                        Test
                                      </span>
                                    </div>
                                  ) : (
                                    <span className={`text-xs sm:text-sm font-bold ${btnStyles.labelText}`}>
                                      {isAdmin && !hasTest ? "+ Test" : "Test"}
                                    </span>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* View Action (Admin Only) */}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handlePreviewPdf(note)}
                            className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/40 dark:text-slate-300 dark:hover:text-blue-400 rounded-xl transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="View PDF"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenManageAccess(note)}
                              className="p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 rounded-xl transition-all border border-blue-200 dark:border-blue-800/40 cursor-pointer"
                              title="Manage Student Access"
                            >
                              <ShieldCheck className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNote(note);
                                setEditChapterNo(group.chapterNo);
                                setEditChapterName(group.chapterName);
                              }}
                              className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 dark:text-amber-400 rounded-xl transition-all border border-amber-200 dark:border-amber-800/40 cursor-pointer"
                              title="Edit Chapter"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteModalNoteId(note.id)}
                              className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-400 rounded-xl transition-all border border-rose-200 dark:border-rose-900/40 cursor-pointer"
                              title="Delete Chapter"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }

                // Multiple PDFs in this Chapter (Collapsible Parent + Parts List)
                const isExpanded = !!expandedChapters[group.chapterNo];

                return (
                  <div
                    key={`chapter-group-${group.chapterNo}`}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex flex-col overflow-hidden transition-all"
                    id={`chapter-group-${group.chapterNo}`}
                  >
                    {/* Parent Chapter Header */}
                    <div 
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-850/50 transition-colors group/hdr"
                      onClick={() => toggleChapterExpand(group.chapterNo)}
                      title="Click to expand/collapse chapter topics"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg group-hover/hdr:bg-blue-50 group-hover/hdr:text-blue-600 dark:group-hover/hdr:bg-blue-950/50 dark:group-hover/hdr:text-blue-400 transition-colors shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <h3 className="flex items-start gap-1.5 font-extrabold text-slate-850 dark:text-slate-100 text-sm min-w-0">
                          <span className="shrink-0">Chapter {group.chapterNo} –</span>
                          <span className="flex-1 break-words group-hover/hdr:text-blue-600 dark:group-hover/hdr:text-blue-400 transition-colors">
                            {group.chapterName}
                          </span>
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Full Chapter Test Button & Score */}
                        {(() => {
                          const firstNote = group.notes[0];
                          const noteClass = firstNote?.classGrade || "Class 10";
                          const studentIdentifier = studentId || studentName;
                          const allAttempts = getAllTestAttempts();
                          const chAttempts = allAttempts.filter((a) => {
                            const matchesStudent = a.studentId === studentIdentifier || (studentName && a.studentName.toLowerCase() === studentName.toLowerCase());
                            const matchesClass = a.classGrade.toLowerCase().trim() === noteClass.toLowerCase().trim();
                            const matchesSubj = a.subject.toLowerCase().trim() === subject.toLowerCase().trim();
                            const matchesCh = a.chapterNo === group.chapterNo;
                            return matchesStudent && matchesClass && matchesSubj && matchesCh && a.testType === "full_chapter";
                          });
                          const latestChAttempt = chAttempts.length > 0 ? chAttempts[chAttempts.length - 1] : null;

                          return (
                            <div className="flex items-center gap-1.5">
                              {latestChAttempt && (
                                <span
                                  className="px-2 py-0.5 rounded-lg text-xs font-black bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-1 shadow-2xs"
                                  title={`Score: ${latestChAttempt.score}/${latestChAttempt.totalQuestions} (${latestChAttempt.percentage}%) on ${latestChAttempt.date}`}
                                >
                                  <Award className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                  <span>{latestChAttempt.score}/{latestChAttempt.totalQuestions} ({latestChAttempt.percentage}%)</span>
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setStudentTestTarget({
                                    classGrade: noteClass,
                                    subject,
                                    chapterNo: group.chapterNo,
                                    chapterName: group.chapterName,
                                    topicName: "Full Chapter Test",
                                    testType: "full_chapter"
                                  });
                                }}
                                className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 text-amber-700 dark:text-amber-300 rounded-lg transition-all border border-amber-200/80 dark:border-amber-800/40 cursor-pointer text-xs font-bold flex items-center gap-1 shadow-2xs"
                                title="Take Full Chapter Practice Test"
                              >
                                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                                <span className="hidden sm:inline">{latestChAttempt ? "Re-take Chapter Test" : "Full Chapter Test"}</span>
                              </button>
                            </div>
                          );
                        })()}

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNote(group.notes[0]);
                                setEditChapterNo(group.chapterNo);
                                setEditChapterName(group.chapterName);
                              }}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 dark:text-amber-400 rounded-lg transition-all border border-amber-200 dark:border-amber-800/40 cursor-pointer text-xs font-bold flex items-center gap-1"
                              title="Edit Chapter"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteGroupModalNotes(group.notes)}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-400 rounded-lg transition-all border border-rose-200 dark:border-rose-900/40 cursor-pointer text-xs font-bold flex items-center gap-1"
                              title="Delete Chapter"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Delete</span>
                            </button>
                          </>
                        )}
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                          {group.notes.length} {group.notes.length === 1 ? "Topic" : "Topics"}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Topics List */}
                    {isExpanded && (
                      <div className="p-3 pt-0 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-950/20 animate-fadeIn">
                        {group.notes.map((note) => (
                          <div
                            key={note.id}
                            onClick={() => handlePreviewPdf(note)}
                            className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-150/80 dark:border-slate-800 flex items-center justify-between gap-3 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 transition-all cursor-pointer group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                              {isImageFile(note.pdfFileName || note.fileName, note.pdfUrl, note.mimeType, note.fileType) ? (
                                <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              ) : (
                                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                              )}
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  {getFormattedTopicLabel(note)}
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {!isFileNameRedundant(getFormattedTopicLabel(note), note.pdfFileName) && note.pdfFileName ? (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 break-words">
                                      {note.pdfFileName} {note.createdAt ? `• ${formatDate(note.createdAt)}` : ""}
                                    </span>
                                  ) : note.createdAt ? (
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 break-words">
                                      {formatDate(note.createdAt)}
                                    </span>
                                  ) : null}
                                  {isAdmin && (
                                    <span
                                      className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                                        note.accessType === "selected"
                                          ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                                          : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                                      }`}
                                    >
                                      {note.accessType === "selected" ? `${note.allowedStudentIds?.length || 0} Students` : "All Students"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {/* Practice Test Button & Score */}
                              {(() => {
                                const topicLabel = getFormattedTopicLabel(note) || `Topic ${group.chapterNo}`;
                                const matchedStud = students.find((s) => s.id === studentId || s.name === studentName);
                                const noteClass = note.classGrade || classGrade || matchedStud?.classGrade || "Class 10";
                                const noteSubj = note.subject || subject;
                                const topicTest = getTopicPracticeTestSync(noteClass, noteSubj, group.chapterNo, topicLabel);
                                const hasTest = !!(topicTest && topicTest.questions && topicTest.questions.length > 0);

                                const studentIdentifier = studentId || studentName;
                                const stats = getTopicTestStats(
                                  allAttempts,
                                  studentIdentifier,
                                  studentName,
                                  noteClass,
                                  subject,
                                  group.chapterNo,
                                  topicLabel
                                );

                                if (!isAdmin && !hasTest) return null;

                                const isAttempted = !!(stats && stats.attemptCount > 0);
                                const btnStyles = getScoreButtonStyles(isAttempted, stats?.bestPercentage);

                                return (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {(hasTest || isAdmin) && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isAdmin) {
                                            setAdminTestTarget({
                                              classGrade: noteClass,
                                              subject,
                                              chapterNo: group.chapterNo,
                                              chapterName: group.chapterName,
                                              topicName: topicLabel
                                            });
                                          } else {
                                            setStudentTestTarget({
                                              classGrade: noteClass,
                                              subject,
                                              chapterNo: group.chapterNo,
                                              chapterName: group.chapterName,
                                              topicName: topicLabel,
                                              testType: "topic"
                                            });
                                          }
                                        }}
                                        className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer shadow-2xs shrink-0 min-h-[40px] flex items-center gap-2 ${btnStyles.container}`}
                                        title={
                                          isAttempted && stats
                                            ? `Highest Score: ${stats.bestScore}/${stats.totalQuestions}`
                                            : "Practice Test for this Topic"
                                        }
                                      >
                                        <FileCheck className={`w-4 h-4 shrink-0 ${btnStyles.icon}`} />
                                        {isAttempted && stats ? (
                                          <div className="flex flex-col items-center justify-center text-center leading-none">
                                            <span className={`text-xs sm:text-sm font-black ${btnStyles.scoreText}`}>
                                              {stats.bestScore}/{stats.totalQuestions}
                                            </span>
                                            <span className={`text-[10px] sm:text-[11px] font-bold mt-0.5 ${btnStyles.labelText}`}>
                                              Test
                                            </span>
                                          </div>
                                        ) : (
                                          <span className={`text-xs sm:text-sm font-bold ${btnStyles.labelText}`}>
                                            {isAdmin && !hasTest ? "+ Test" : "Test"}
                                          </span>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}

                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handlePreviewPdf(note)}
                                  className="p-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                                  title="View PDF"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenManageAccess(note)}
                                    className="p-1.5 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 text-blue-600 dark:text-blue-400 rounded-lg transition-all border border-blue-200 dark:border-blue-800 cursor-pointer"
                                    title="Manage Student Access"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingNote(note);
                                      setEditChapterNo(note.chapterNo);
                                      setEditChapterName(note.chapterName);
                                    }}
                                    className="p-1.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-600 dark:text-amber-400 rounded-lg transition-all border border-amber-200 dark:border-amber-800/40 cursor-pointer"
                                    title="Edit Topic"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteModalNoteId(note.id)}
                                    className="p-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-600 dark:text-rose-400 rounded-lg transition-all border border-rose-200 dark:border-rose-900/40 cursor-pointer"
                                    title="Delete Topic"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div 
                className="flex flex-col items-center justify-center py-16 text-center px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/50"
                id="empty-notes-placeholder"
              >
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 text-slate-400 rounded-2xl mb-3">
                  <BookOpen className="w-8 h-8 stroke-[1.2]" />
                </div>
                <h3 className="text-slate-800 dark:text-slate-200 font-bold text-sm">
                  {searchQuery ? "No matching chapters found." : `No notes are available for ${subject}.`}
                </h3>
                <p className="text-slate-400 text-xs mt-1 max-w-xs leading-relaxed">
                  {searchQuery ? "Try searching with a different term." : "No chapter notes have been assigned to you for this subject."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- EDIT CHAPTER MODAL --- */}
      {editingNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Edit Chapter Details</span>
              </h3>
              <button
                onClick={() => setEditingNote(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editChapterNo || Number(editChapterNo) <= 0) {
                  setEditError("Please enter a valid chapter number");
                  return;
                }
                if (!editChapterName.trim()) {
                  setEditError("Please enter a chapter name");
                  return;
                }
                try {
                  setIsEditingSaving(true);
                  setEditError("");
                  if (onEditNote) {
                    await onEditNote(editingNote.id, Number(editChapterNo), editChapterName.trim());
                  }
                  setEditingNote(null);
                } catch (err: any) {
                  console.error(err);
                  setEditError("Unable to update chapter. Please try again.");
                } finally {
                  setIsEditingSaving(false);
                }
              }}
              className="flex flex-col gap-3.5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter Number
                </label>
                <input
                  type="number"
                  min="1"
                  value={editChapterNo}
                  onChange={(e) => setEditChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter Name
                </label>
                <input
                  type="text"
                  value={editChapterName}
                  onChange={(e) => setEditChapterName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                  required
                />
              </div>

              {editError && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{editError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                  disabled={isEditingSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  disabled={isEditingSaving}
                >
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MANAGE ACCESS OVERLAY / MODAL FOR EXISTING CHAPTER NOTE --- */}
      {managingAccessNote && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[110] animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                    Manage Student Access
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Chapter {managingAccessNote.chapterNo}: {managingAccessNote.chapterName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setManagingAccessNote(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Access Type
              </label>

              <div className="flex flex-col gap-2">
                <label className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer hover:border-blue-300 transition">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="manageAccessType"
                      value="all"
                      checked={manageAccessType === "all"}
                      onChange={() => setManageAccessType("all")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <Globe className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">All Students</p>
                      <p className="text-[10px] text-slate-400">Every student enrolled in this subject can access this PDF.</p>
                    </div>
                  </div>
                </label>

                <label className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer hover:border-blue-300 transition">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="manageAccessType"
                      value="selected"
                      checked={manageAccessType === "selected"}
                      onChange={() => {
                        setManageAccessType("selected");
                        setIsManageAccessModalOpen(true);
                      }}
                      className="w-4 h-4 text-blue-600"
                    />
                    <Users className="w-4 h-4 text-blue-500 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Selected Students</p>
                      <p className="text-[10px] text-slate-400">Restrict access to specific chosen students only.</p>
                    </div>
                  </div>
                </label>
              </div>

              {manageAccessType === "selected" && (
                <div className="flex items-center justify-between p-3 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <span>{manageAllowedStudentIds.length} Students Allowed Access</span>
                  <button
                    type="button"
                    onClick={() => setIsManageAccessModalOpen(true)}
                    className="px-3 py-1.5 text-[11px] font-extrabold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer"
                  >
                    Select Students
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setManagingAccessNote(null)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveManageAccess(manageAllowedStudentIds)}
                className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition cursor-pointer"
              >
                Save Permissions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SELECT STUDENTS MODAL FOR UPLOAD FORM --- */}
      <SelectStudentsModal
        isOpen={isUploadStudentModalOpen}
        onClose={() => setIsUploadStudentModalOpen(false)}
        onSave={(selectedIds) => {
          setUploadAllowedStudentIds(selectedIds);
          setIsUploadStudentModalOpen(false);
        }}
        initialSelectedIds={uploadAllowedStudentIds}
        students={students}
        title="Select Students for Uploaded Note"
      />

      {/* --- SELECT STUDENTS MODAL FOR MANAGE ACCESS --- */}
      <SelectStudentsModal
        isOpen={isManageAccessModalOpen}
        onClose={() => setIsManageAccessModalOpen(false)}
        onSave={(selectedIds) => {
          setManageAllowedStudentIds(selectedIds);
          setIsManageAccessModalOpen(false);
        }}
        initialSelectedIds={manageAllowedStudentIds}
        students={students}
        title="Manage Student Permissions"
      />

      {/* --- CONFIRM DELETE MODAL FOR SINGLE NOTE --- */}
      <ConfirmDeleteModal
        isOpen={!!deleteModalNoteId}
        title="Delete Chapter PDF"
        message="Are you sure you want to permanently delete this chapter PDF note? This action cannot be undone."
        isDeleting={isDeleting}
        onConfirm={async () => {
          if (!deleteModalNoteId) return;
          try {
            setIsDeleting(true);
            await onDeleteNote(deleteModalNoteId);
            setDeleteModalNoteId(null);
          } catch (err: any) {
            console.error("Failed to delete note:", err);
          } finally {
            setIsDeleting(false);
          }
        }}
        onCancel={() => setDeleteModalNoteId(null)}
      />

      {/* --- CONFIRM DELETE MODAL FOR ENTIRE CHAPTER GROUP --- */}
      <ConfirmDeleteModal
        isOpen={!!deleteGroupModalNotes}
        title="Delete Entire Chapter"
        message={`Are you sure you want to delete all topics/PDFs in Chapter ${deleteGroupModalNotes?.[0]?.chapterNo || ""}? This action cannot be undone.`}
        isDeleting={isDeleting}
        onConfirm={async () => {
          if (!deleteGroupModalNotes) return;
          try {
            setIsDeleting(true);
            for (const note of deleteGroupModalNotes) {
              await onDeleteNote(note.id);
            }
            setDeleteGroupModalNotes(null);
          } catch (err: any) {
            console.error("Failed to delete chapter group:", err);
          } finally {
            setIsDeleting(false);
          }
        }}
        onCancel={() => setDeleteGroupModalNotes(null)}
      />

      {/* --- STUDENT PRACTICE TEST MODAL --- */}
      {studentTestTarget && (
        <StudentPracticeTestModal
          isOpen={!!studentTestTarget}
          onClose={() => setStudentTestTarget(null)}
          studentId={studentId || "student_local"}
          studentName={studentName || "Student"}
          classGrade={studentTestTarget.classGrade}
          subject={studentTestTarget.subject}
          chapterNo={studentTestTarget.chapterNo}
          chapterName={studentTestTarget.chapterName}
          topicName={studentTestTarget.topicName}
          testType={studentTestTarget.testType}
          serviceStatus={currentServiceStatus}
        />
      )}

      {/* --- ADMIN PRACTICE TEST MODAL --- */}
      {adminTestTarget && (
        <AdminPracticeTestModal
          isOpen={!!adminTestTarget}
          onClose={() => setAdminTestTarget(null)}
          onPracticeTestChanged={() => {
            setAttemptsVersion((prev) => prev + 1);
          }}
          classGrade={adminTestTarget.classGrade}
          subject={adminTestTarget.subject}
          chapterNo={adminTestTarget.chapterNo}
          chapterName={adminTestTarget.chapterName}
          topicName={adminTestTarget.topicName}
        />
      )}

      {/* --- TOPIC TEST STATISTICS MODAL --- */}
      {selectedStatsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setSelectedStatsModal(null)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-5" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Topic Test Statistics
                  </h3>
                </div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                  Ch {selectedStatsModal.chapterNo}: {selectedStatsModal.topicName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStatsModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stats Items */}
            <div className="space-y-2.5 text-xs font-medium">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400 font-bold flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-500 shrink-0" />
                  Best Score
                </span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {selectedStatsModal.stats.bestScore}/{selectedStatsModal.stats.totalQuestions}{" "}
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 ml-1">
                    ({selectedStatsModal.stats.bestPercentage}%)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400 font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                  Latest Score
                </span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {selectedStatsModal.stats.latestScore}/{selectedStatsModal.stats.latestTotalQuestions}{" "}
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 ml-1">
                    ({selectedStatsModal.stats.latestPercentage}%)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400 font-bold flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-purple-500 shrink-0" />
                  Attempts
                </span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {selectedStatsModal.stats.attemptCount}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400 font-bold flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  Average Score
                </span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {selectedStatsModal.stats.averageScore.toFixed(1)}/{selectedStatsModal.stats.totalQuestions}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-600 dark:text-slate-400 font-bold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
                  Last Attempt
                </span>
                <span className="font-extrabold text-slate-800 dark:text-slate-200">
                  {selectedStatsModal.stats.lastAttemptDate}
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setSelectedStatsModal(null)}
                className="w-full py-2.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-black rounded-xl transition-all shadow-md cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PDF / IMAGE VIEWER MODAL --- */}
      {activePreviewPdf && (
        <PdfViewer
          url={activePreviewPdf.url}
          title={activePreviewPdf.title}
          noteId={activePreviewPdf.noteId}
          storagePath={activePreviewPdf.storagePath}
          bucket={activePreviewPdf.bucket}
          fileName={activePreviewPdf.fileName}
          mimeType={activePreviewPdf.mimeType}
          fileType={activePreviewPdf.fileType}
          onClose={() => setActivePreviewPdf(null)}
        />
      )}
    </div>
  );
}
