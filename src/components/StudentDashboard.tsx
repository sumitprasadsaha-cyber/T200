import React, { useEffect, useMemo, useState } from "react";
import { APP_VERSION } from "../config";
import { safeLocalStorageSetItem } from "../lib/safeStorage";
import StudentAvatar from "./StudentAvatar";
import { saveAndOpenGeneratedPdf } from "../lib/nativePdfService";
import {
  BookOpen,
  CreditCard,
  Info,
  ChevronRight,
  ChevronLeft,
  Camera,
  Circle,
  MessageSquareText,
  FileText,
  Users,
  X,
  Eye,
  Download,
  AlertCircle,
  Cpu,
  Atom,
  Loader2,
  FlaskConical,
  Dna,
  Globe,
  Scroll,
  Languages,
  CalendarDays,
  Clock3,
  CircleDollarSign,
  IndianRupee,
  ReceiptText,
  TrendingUp,
  CheckCircle2,
  Search,
  Smartphone,
  Landmark,
  Bell,
  Calculator,
  RefreshCw,
  Microscope,
  Compass,
  Coins,
  GraduationCap,
  Train,
  Shield,
  Magnet,
  Beaker,
  Laptop,
  Code,
  LineChart,
  Briefcase,
  Scale,
  Leaf,
  Palette,
  Music,
  Dumbbell,
  Lightbulb,
  ShoppingBag,
  Brain,
  PieChart,
  BarChart,
  Book,
  Trash2,
  ChevronDown
} from "lucide-react";
import { jsPDF } from "jspdf";
import { AnimatePresence, motion } from "motion/react";
import { Student, ChapterNote } from "../types";
import { ALL_ACADEMIC_MONTHS, MONTH_NAMES } from "../utils/monthHelper";
import { groupAndSortChapterNotes, getFormattedTopicLabel, isFileNameRedundant } from "../utils/chapterNotesHelper";
import { subscribeToAnnouncements, saveStudentDoc, subscribeToClassNotes, getLocalClassNotes, areClassNotesEqual, updateStudentPresence } from "../lib/firestoreService";
import { uploadReportToStorage, getBucketName, sanitizeStoragePath } from "../lib/storageService";
import PdfViewer from "./PdfViewer";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { getPdfDownloadUrl } from "../lib/pdfService";
import { dataUrlToBlob } from "../utils/pdfUtils";
import { supabase } from "../lib/supabaseClient";
import ChapterProgressBottomSheet from "./ChapterProgressBottomSheet";
import { getChapterProgressRecord, getStatusConfig, calculateSubjectProgress, calculateSubjectWeightedProgress, calculateSubjectTestProgress, SubjectReportData, normalizeStatusLabel } from "../utils/chapterProgressHelper";
import SubjectReportModal from "./SubjectReportModal";
import {
  getEvaluatedFeeStatus,
  getEvaluatedStudentLedger,
  getPendingFeeMonths,
  calculateStudentOutstandingAmount
} from "../utils/feeBillingHelper";
import { ChapterProgressData, ClassNote } from "../types";
import { FileCheck } from "lucide-react";
import { filterNotesForStudent, filterSubjectsForStudent } from "../utils/noteAccessHelper";
import { filterClassNotesForStudent, getStudentSubjects, isSubjectMatching } from "../utils/classNoteHelper";
import StudentPracticeTestModal from "./StudentPracticeTestModal";
import { getTopicPracticeTest, getStudentTestAttempts, getAllTestAttempts, fetchAllPracticeTestsFromSupabase } from "../utils/assessmentParser";
import { getScoreButtonStyles } from "../lib/practiceTestService";
import { fetchStudentTestAttemptsFromSupabase } from "../lib/testScorePersistence";

interface StudentDashboardProps {
  student: Student;
  onSelectSubject: (subject: string) => void;
  onNavigateToTab: (tab: "Settings" | "My") => void;
  onOpenAvatarModal: () => void;
  onUpdateChapterRemark: (subject: string, noteId: string, remark: string) => void;
  onDeleteNote?: (subject: string, noteId: string) => void;
  onUpdateStudent?: (student: Student) => void;
  isAdmin?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export async function generateSubjectPdfReport(student: Student, subject: string, notes: ChapterNote[]) {
  const doc = new jsPDF();
  const currentDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Header Box
  doc.setFillColor(37, 99, 235); // Blue primary
  doc.rect(0, 0, 210, 40, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SUBJECT PERFORMANCE REPORT", 14, 22);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated on: ${currentDate}`, 14, 29);
  doc.text(`App Version: ${APP_VERSION}`, 14, 34);

  // Student & Subject Info Section
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Student Information", 14, 52);

  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(14, 55, 196, 55);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text("Student Name:", 14, 63);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(student.name, 45, 63);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text("Class / Grade:", 14, 70);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(student.classGrade || "N/A", 45, 70);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text("Subject Name:", 110, 63);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(37, 99, 235);
  doc.text(subject, 140, 63);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text("Enrolled Date:", 110, 70);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(student.registrationDate ? new Date(student.registrationDate).toLocaleDateString("en-IN") : "N/A", 140, 70);

  // Progress metrics calculation
  const totalChapters = notes.length;
  const completedChapters = notes.filter((n) => n.isCompleted).length;
  const completionRate = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

  // Statistics Box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(14, 80, 182, 25, "F");
  doc.setDrawColor(241, 245, 249);
  doc.rect(14, 80, 182, 25, "S");

  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Total Chapters", 22, 88);
  doc.text("Completed", 85, 88);
  doc.text("Completion Rate", 145, 88);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`${totalChapters}`, 22, 97);
  doc.text(`${completedChapters}`, 85, 97);
  doc.setTextColor(16, 185, 129); // emerald-500
  doc.text(`${completionRate}%`, 145, 97);

  // Chapter-by-chapter details
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("Chapter-by-Chapter Course Progress", 14, 118);

  doc.setDrawColor(226, 232, 240);
  doc.line(14, 121, 196, 121);

  // Table Header
  doc.setFillColor(241, 245, 249); // slate-100
  doc.rect(14, 127, 182, 8, "F");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Ch #", 16, 132);
  doc.text("Chapter Name", 28, 132);
  doc.text("Status", 85, 132);
  doc.text("Progress %", 125, 132);
  doc.text("Student Remarks / Last Updated", 150, 132);

  let y = 141;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);

  if (notes.length === 0) {
    doc.setTextColor(148, 163, 184); // slate-400
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("No chapters or study materials uploaded for this subject yet.", 14, 145);
  } else {
    notes.forEach((note) => {
      const progRecord = getChapterProgressRecord(note.id, subject, student.chapterProgress);
      const statusConfig = getStatusConfig(progRecord?.selectedStatus) || { label: "Not Started", percent: 0, color: "text-slate-500", bg: "bg-slate-100" };
      const statusText = statusConfig.label;
      const progressPct = progRecord?.calculatedProgress ?? statusConfig.percent;
      const remarksText = progRecord?.remarks || note.remark || "—";
      const updatedStr = progRecord?.updatedAt
        ? new Date(progRecord.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
        : "—";

      if (y > 265) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${note.chapterNo || "-"}`, 16, y);
      doc.setFont("helvetica", "normal");
      
      // Limit chapter name length
      let chapName = note.chapterName || "Untitled Chapter";
      if (chapName.length > 25) {
        chapName = chapName.substring(0, 23) + "...";
      }
      doc.text(chapName, 28, y);

      doc.setFont("helvetica", "bold");
      if (progressPct === 100) {
        doc.setTextColor(16, 185, 129); // emerald-500
      } else if (progressPct >= 50) {
        doc.setTextColor(37, 99, 235); // blue-600
      } else {
        doc.setTextColor(245, 158, 11); // amber-500
      }
      doc.text(statusText.substring(0, 18), 85, y);

      doc.text(`${progressPct}%`, 125, y);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);

      let displayRem = remarksText.replace(/\n/g, " ");
      if (displayRem.length > 20) {
        displayRem = displayRem.substring(0, 18) + "...";
      }
      doc.text(`${displayRem} (${updatedStr})`, 150, y);

      // line under row
      doc.setDrawColor(241, 245, 249);
      doc.line(14, y + 3, 196, y + 3);

      y += 10;
      doc.setTextColor(15, 23, 42);
    });
  }

  // Footer
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(148, 163, 184);
  doc.text("This report is generated dynamically by the Personal Study Space portal.", 14, 280);
  doc.text("© 2026 Sumit Tuition App", 150, 280);

  // Save PDF report with robust fallback
  const fileName = `${(student?.name || "Student").replace(/\s+/g, "_")}_${subject.replace(/\s+/g, "_")}_Report.pdf`;
  try {
    const pdfBlob = doc.output("blob");
    await saveAndOpenGeneratedPdf(pdfBlob, fileName);
  } catch (error) {
    console.warn("[PDF Generator] Native save failed, using fallback:", error);
    try {
      doc.save(fileName);
    } catch (e) {
      console.error("[PDF Generator] Fallback save failed:", e);
    }
  }

  // Automatically upload the generated report to Supabase Storage and store metadata in Firestore
  try {
    const blob = doc.output("blob");
    console.log(`[StudentDashboard] Uploading subject progress report to Supabase Storage: ${fileName}`);
    
    (async () => {
      try {
        const metadata = await uploadReportToStorage(student.id, blob, fileName);
        
        const newReport = {
          id: `report-${Date.now()}`,
          storageProvider: "supabase" as const,
          bucket: metadata.bucket,
          storagePath: metadata.storagePath,
          fileName: metadata.fileName,
          fileSize: metadata.fileSize,
          mimeType: metadata.mimeType,
          uploadedAt: metadata.uploadedAt,
          uploadedBy: student.name,
          downloadUrl: metadata.downloadUrl,
        };

        const updatedStudent = {
          ...student,
          reports: [...(student.reports || []), newReport],
        };

        await saveStudentDoc(updatedStudent);
        console.log("[StudentDashboard] Successfully uploaded subject report and saved metadata to Firestore.");
      } catch (uploadError) {
        console.error("[StudentDashboard] Failed to upload subject report to Supabase in background:", uploadError);
      }
    })();
  } catch (blobError) {
    console.error("[StudentDashboard] Failed to generate blob for upload:", blobError);
  }
}

function formatDate(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

interface SubjectColorPalette {
  from: string;
  bg: string;
  text: string;
  darkText: string;
  accent: string;
  ring: string;
  badge: string;
  badgeText: string;
}

interface SubjectCardPalette {
  shell: string;
  accent: string;
  ring: string;
  chip: string;
  text: string;
  shadow: string;
}

interface SubjectVisualStyle {
  topBar: string;
  iconBg: string;
  iconAccent: string;
  ring: string;
  badge: string;
  border: string;
  shadow: string;
}

function getSubjectVisualStyle(subjectName: string): SubjectVisualStyle {
  const normalized = subjectName.trim().toLowerCase();
  const styles: Record<string, SubjectVisualStyle> = {
    mathematics: {
      topBar: "from-sky-500 via-blue-500 to-indigo-600",
      iconBg: "bg-sky-50",
      iconAccent: "text-sky-600",
      ring: "text-sky-600",
      badge: "bg-sky-50 text-sky-700",
      border: "border-sky-100",
      shadow: "shadow-[0_16px_40px_rgba(14,116,144,0.10)]"
    },
    economics: {
      topBar: "from-emerald-500 via-teal-500 to-cyan-600",
      iconBg: "bg-emerald-50",
      iconAccent: "text-emerald-600",
      ring: "text-emerald-600",
      badge: "bg-emerald-50 text-emerald-700",
      border: "border-emerald-100",
      shadow: "shadow-[0_16px_40px_rgba(16,185,129,0.10)]"
    },
    english: {
      topBar: "from-violet-500 via-fuchsia-500 to-purple-600",
      iconBg: "bg-violet-50",
      iconAccent: "text-violet-600",
      ring: "text-violet-600",
      badge: "bg-violet-50 text-violet-700",
      border: "border-violet-100",
      shadow: "shadow-[0_16px_40px_rgba(139,92,246,0.10)]"
    },
    science: {
      topBar: "from-cyan-500 via-sky-500 to-blue-600",
      iconBg: "bg-cyan-50",
      iconAccent: "text-cyan-600",
      ring: "text-cyan-600",
      badge: "bg-cyan-50 text-cyan-700",
      border: "border-cyan-100",
      shadow: "shadow-[0_16px_40px_rgba(6,182,212,0.10)]"
    },
    "social science": {
      topBar: "from-rose-500 via-orange-500 to-amber-500",
      iconBg: "bg-rose-50",
      iconAccent: "text-rose-600",
      ring: "text-rose-600",
      badge: "bg-rose-50 text-rose-700",
      border: "border-rose-100",
      shadow: "shadow-[0_16px_40px_rgba(244,63,94,0.10)]"
    },
    hindi: {
      topBar: "from-pink-500 via-rose-500 to-fuchsia-500",
      iconBg: "bg-pink-50",
      iconAccent: "text-pink-600",
      ring: "text-pink-600",
      badge: "bg-pink-50 text-pink-700",
      border: "border-pink-100",
      shadow: "shadow-[0_16px_40px_rgba(236,72,153,0.10)]"
    },
    nepali: {
      topBar: "from-indigo-500 via-blue-500 to-violet-600",
      iconBg: "bg-indigo-50",
      iconAccent: "text-indigo-600",
      ring: "text-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
      border: "border-indigo-100",
      shadow: "shadow-[0_16px_40px_rgba(79,70,229,0.10)]"
    },
    "computer science": {
      topBar: "from-amber-500 via-orange-500 to-red-500",
      iconBg: "bg-amber-50",
      iconAccent: "text-amber-600",
      ring: "text-amber-600",
      badge: "bg-amber-50 text-amber-700",
      border: "border-amber-100",
      shadow: "shadow-[0_16px_40px_rgba(245,158,11,0.10)]"
    },
    polity: {
      topBar: "from-indigo-600 via-blue-600 to-sky-600",
      iconBg: "bg-indigo-50",
      iconAccent: "text-indigo-600",
      ring: "text-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
      border: "border-indigo-100",
      shadow: "shadow-[0_16px_40px_rgba(79,70,229,0.10)]"
    },
    history: {
      topBar: "from-amber-600 via-amber-700 to-yellow-800",
      iconBg: "bg-amber-50",
      iconAccent: "text-amber-700",
      ring: "text-amber-700",
      badge: "bg-amber-50 text-amber-800",
      border: "border-amber-100",
      shadow: "shadow-[0_16px_40px_rgba(180,83,9,0.10)]"
    },
    geography: {
      topBar: "from-teal-500 via-emerald-600 to-green-700",
      iconBg: "bg-teal-50",
      iconAccent: "text-teal-600",
      ring: "text-teal-600",
      badge: "bg-teal-50 text-teal-700",
      border: "border-teal-100",
      shadow: "shadow-[0_16px_40px_rgba(13,148,136,0.10)]"
    },
    economy: {
      topBar: "from-emerald-500 via-teal-500 to-cyan-600",
      iconBg: "bg-emerald-50",
      iconAccent: "text-emerald-600",
      ring: "text-emerald-600",
      badge: "bg-emerald-50 text-emerald-700",
      border: "border-emerald-100",
      shadow: "shadow-[0_16px_40px_rgba(16,185,129,0.10)]"
    },
    environment: {
      topBar: "from-green-500 via-emerald-600 to-teal-600",
      iconBg: "bg-green-50",
      iconAccent: "text-green-600",
      ring: "text-green-600",
      badge: "bg-green-50 text-green-700",
      border: "border-green-100",
      shadow: "shadow-[0_16px_40px_rgba(34,197,94,0.10)]"
    },
    ethics: {
      topBar: "from-purple-600 via-violet-600 to-indigo-600",
      iconBg: "bg-purple-50",
      iconAccent: "text-purple-600",
      ring: "text-purple-600",
      badge: "bg-purple-50 text-purple-700",
      border: "border-purple-100",
      shadow: "shadow-[0_16px_40px_rgba(147,51,234,0.10)]"
    },
    "science & technology": {
      topBar: "from-cyan-500 via-blue-600 to-indigo-600",
      iconBg: "bg-cyan-50",
      iconAccent: "text-cyan-600",
      ring: "text-cyan-600",
      badge: "bg-cyan-50 text-cyan-700",
      border: "border-cyan-100",
      shadow: "shadow-[0_16px_40px_rgba(6,182,212,0.10)]"
    },
    "current affairs": {
      topBar: "from-rose-500 via-pink-600 to-red-600",
      iconBg: "bg-rose-50",
      iconAccent: "text-rose-600",
      ring: "text-rose-600",
      badge: "bg-rose-50 text-rose-700",
      border: "border-rose-100",
      shadow: "shadow-[0_16px_40px_rgba(244,63,94,0.10)]"
    },
    "international relations": {
      topBar: "from-blue-600 via-indigo-600 to-violet-700",
      iconBg: "bg-blue-50",
      iconAccent: "text-blue-600",
      ring: "text-blue-600",
      badge: "bg-blue-50 text-blue-700",
      border: "border-blue-100",
      shadow: "shadow-[0_16px_40px_rgba(37,99,235,0.10)]"
    }
  };

  if (styles[normalized]) return styles[normalized];
  const found = Object.keys(styles).find((key) => normalized.includes(key));
  if (found) return styles[found];

  return {
    topBar: "from-slate-400 via-slate-500 to-slate-600",
    iconBg: "bg-slate-50",
    iconAccent: "text-slate-600",
    ring: "text-slate-600",
    badge: "bg-slate-100 text-slate-700",
    border: "border-slate-100",
    shadow: "shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
  };
}

function getSubjectCardPalette(subjectName: string, index: number): SubjectCardPalette {
  const palettes: SubjectCardPalette[] = [
    {
      shell: "from-sky-500 via-blue-600 to-indigo-700",
      accent: "text-sky-700",
      ring: "text-sky-600",
      chip: "bg-sky-100/80 text-sky-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-emerald-500 via-teal-500 to-cyan-600",
      accent: "text-emerald-700",
      ring: "text-emerald-600",
      chip: "bg-emerald-100/80 text-emerald-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-amber-500 via-orange-500 to-red-500",
      accent: "text-amber-700",
      ring: "text-amber-600",
      chip: "bg-amber-100/80 text-amber-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-violet-500 via-purple-600 to-indigo-700",
      accent: "text-violet-700",
      ring: "text-violet-600",
      chip: "bg-violet-100/80 text-violet-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-rose-500 via-pink-500 to-purple-600",
      accent: "text-pink-700",
      ring: "text-pink-600",
      chip: "bg-pink-100/80 text-pink-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-cyan-500 via-teal-500 to-emerald-600",
      accent: "text-cyan-700",
      ring: "text-cyan-600",
      chip: "bg-cyan-100/80 text-cyan-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-indigo-600 via-violet-600 to-fuchsia-700",
      accent: "text-teal-700",
      ring: "text-teal-600",
      chip: "bg-teal-100/80 text-teal-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-yellow-500 via-amber-500 to-orange-600",
      accent: "text-yellow-700",
      ring: "text-yellow-600",
      chip: "bg-yellow-100/80 text-yellow-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-lime-500 via-green-500 to-emerald-600",
      accent: "text-lime-700",
      ring: "text-lime-600",
      chip: "bg-lime-100/80 text-lime-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    },
    {
      shell: "from-red-500 via-rose-500 to-pink-600",
      accent: "text-red-700",
      ring: "text-red-600",
      chip: "bg-red-100/80 text-red-700",
      text: "text-slate-900",
      shadow: "shadow-none"
    }
  ];
  return palettes[index % palettes.length];
}

function getWeeklyAttendanceDays(student: Student) {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));

  const entries: Array<{ label: string; key: string; status: "present" | "absent" | "holiday" | "hidden" | "na" }> = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(monday);
    current.setDate(monday.getDate() + offset);
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    const rawValue = student.attendance?.[key];

    if (rawValue === true) {
      entries.push({ label: current.toLocaleDateString("en-IN", { weekday: "short" }), key, status: "present" });
    } else if (rawValue === false) {
      entries.push({ label: current.toLocaleDateString("en-IN", { weekday: "short" }), key, status: "absent" });
    } else {
      entries.push({ label: current.toLocaleDateString("en-IN", { weekday: "short" }), key, status: "na" });
    }
  }

  return entries;
}

function getCalendarDaysForMonth(student: Student, targetDate: Date) {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay();
  const paddingDays = (startWeekday + 6) % 7;
  const monthDays: Array<{ key: string; value: string | null; status: "present" | "absent" | "holiday" | "na" | "none" | "unmarked" }> = [];

  for (let index = 0; index < paddingDays; index += 1) {
    monthDays.push({ key: `empty-${index}`, value: null, status: "none" });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const current = new Date(year, month, day);
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;
    const rawValue = student.attendance?.[key];
    let status: "present" | "absent" | "holiday" | "na" | "none" | "unmarked" = "unmarked";
    if (rawValue === true) {
      status = "present";
    } else if (rawValue === false) {
      status = "absent";
    } else if (rawValue === "na") {
      status = "na";
    } else if (current.getDay() === 0 || current.getDay() === 6) {
      status = "holiday";
    }
    monthDays.push({ key, value: `${day}`, status });
  }

  return monthDays;
}

function getCalendarDaysForCurrentMonth(student: Student, targetDate = new Date()) {
  return getCalendarDaysForMonth(student, targetDate);
}

function getPaymentModeMeta(mode?: string) {
  const normalized = (mode || "").toLowerCase();
  if (normalized.includes("upi") || normalized.includes("phonepe") || normalized.includes("gpay")) {
    return { label: "UPI", icon: <Smartphone className="h-3.5 w-3.5" /> };
  }
  if (normalized.includes("card")) {
    return { label: "Card", icon: <CreditCard className="h-3.5 w-3.5" /> };
  }
  if (normalized.includes("bank") || normalized.includes("transfer")) {
    return { label: "Bank transfer", icon: <Landmark className="h-3.5 w-3.5" /> };
  }
  if (normalized.includes("cash") || normalized.includes("offline")) {
    return { label: "Cash", icon: <CircleDollarSign className="h-3.5 w-3.5" /> };
  }
  return { label: "—", icon: <ReceiptText className="h-3.5 w-3.5" /> };
}

interface StudentDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
  formatDate: (value?: string) => string;
}

function StudentDetailsModal({ isOpen, onClose, student, formatDate }: StudentDetailsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-hidden rounded-[30px] border border-slate-200/70 bg-white p-4 shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 pb-2 shrink-0">
          <div>
            <h3 className="text-base font-black text-slate-900">Student Details</h3>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-1.5 text-slate-500 cursor-pointer hover:bg-slate-200 transition">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        
        <div className="mt-3 flex flex-col gap-2.5 overflow-y-auto pr-1 min-h-0 flex-1">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
            <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Student</p>
            <p className="mt-0.5 text-sm font-black text-slate-900">{student.name}</p>
            <p className="text-[11px] text-slate-500 font-semibold">{student.classGrade || "Class not assigned"}</p>
          </div>
          
          <div className="grid gap-2 grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Phone</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-700">{student.phone || "N/A"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Parent Phone</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-700">{student.parentPhone || "N/A"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Email</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-700 truncate" title={student.email || ""}>{student.email || "N/A"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Joined Date</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-700">{student.registrationDate ? formatDate(student.registrationDate) : "N/A"}</p>
            </div>
          </div>

          <div className="grid gap-2 grid-cols-2">
            <div className="rounded-2xl border border-indigo-50 bg-indigo-50/45 p-2.5 col-span-2">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-indigo-600">Password</p>
              <p className="mt-0.5 text-xs font-bold text-slate-700">{student.password || "N/A"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 col-span-2">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400 mb-1.5">Enrolled Subjects</p>
              <div className="flex flex-wrap gap-1.5">
                {!student.enrolledSubjects || student.enrolledSubjects.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No enrolled subjects</span>
                ) : (
                  student.enrolledSubjects.map((sub) => (
                    <span
                      key={sub}
                      className="text-xs font-bold px-3 py-1 bg-blue-50 text-blue-600 rounded-full border border-blue-100/20"
                    >
                      {sub}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StudentHeaderProps {
  student: Student;
}

function StudentHeader({ student }: StudentHeaderProps) {
  return (
    <div className="sticky top-0 z-20 mb-4 flex items-center justify-between rounded-[24px] border border-slate-200/70 bg-white/80 px-3.5 py-2.5 shadow-[0_10px_35px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.18)]" />
        <span className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-600">
          Student Portal : {student.name.toUpperCase()}
        </span>
      </div>
      <div className="rounded-full border border-slate-200/70 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">
        v{APP_VERSION}
      </div>
    </div>
  );
}

interface HeroCardProps {
  student: Student;
  onOpenAvatarModal: () => void;
  onOpenStudentDetails: () => void;
  formatDate: (value?: string) => string;
  onOpenAnnouncements: () => void;
  hasAnnouncements?: boolean;
}

function HeroCard({ student, onOpenAvatarModal, onOpenStudentDetails, formatDate, onOpenAnnouncements, hasAnnouncements }: HeroCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenStudentDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenStudentDetails();
        }
      }}
      className="group relative overflow-hidden rounded-[24px] border border-white/20 bg-gradient-to-br from-blue-600 to-violet-600 px-4 py-3.5 sm:px-5 sm:py-4.5 text-white shadow-none"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.2),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.14),transparent_32%)]" />
      
      {/* Announcements Circle Icon Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenAnnouncements();
        }}
        className="absolute top-3.5 right-3.5 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/25 active:scale-90 transition-all text-white cursor-pointer"
        title="Academy Announcements"
      >
        <Bell className="h-4 w-4" />
        {hasAnnouncements && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          </span>
        )}
      </button>

      <div className="relative flex min-h-[90px] flex-col items-start gap-3 sm:min-h-[110px] sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3.5 w-full">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenAvatarModal();
            }}
            className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-3 border-white/80 bg-white/10 shadow-sm transition-transform duration-200 hover:scale-105 sm:h-18 sm:w-18 cursor-pointer"
            title="Upload and edit photo"
          >
            <StudentAvatar
              student={student}
              className="w-full h-full rounded-full"
              initialsClassName="text-lg font-black text-white"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Camera className="h-4 w-4 text-white drop-shadow-sm" />
            </div>
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black leading-none text-white sm:text-xl">{student.name}</p>
            <p className="mt-1 max-w-full text-[11px] sm:text-xs leading-normal text-white/80">Keep track of notes, progress and attendance.</p>
            {student.registrationDate && (
              <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] sm:text-xs font-semibold text-white/95">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="truncate">Joined {formatDate(student.registrationDate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface WeeklyAttendanceChecklistProps {
  entries: Array<{ label: string; key: string; status: "present" | "absent" | "holiday" | "hidden" | "na" }>;
}

function WeeklyAttendanceChecklist({ entries }: WeeklyAttendanceChecklistProps) {
  return (
    <div className="flex items-start justify-between gap-1.5">
      {entries.map((entry) => {
        const isPresent = entry.status === "present";
        const isAbsent = entry.status === "absent";
        const isHoliday = entry.status === "holiday";
        const isHidden = entry.status === "hidden";
        if (isHidden) return null;

        const entryDate = new Date(`${entry.key}T12:00:00`);
        const dateLabel = entryDate.toLocaleDateString("en-IN", { day: "numeric" });
        const weekdayLabel = entryDate.toLocaleDateString("en-IN", { weekday: "short" }).toUpperCase();

        return (
          <div key={entry.key} className="flex min-w-[30px] flex-1 flex-col items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-black ${isPresent ? "border-white/30 bg-white/90 text-emerald-700" : isAbsent ? "border-white/30 bg-white/95 text-rose-600" : isHoliday ? "border-white/20 bg-white/15 text-white" : "border-white/20 bg-white/15 text-white/80"}`}>
              {isPresent ? (
                <span className="leading-none">✓</span>
              ) : isAbsent ? (
                <span className="text-[11px] leading-none font-black">✕</span>
              ) : isHoliday ? (
                <span className="text-[8px] leading-none">H</span>
              ) : (
                <span className="text-[7px] leading-none">NA</span>
              )}
            </div>
            <div className="text-center">
              <div className="text-[8px] font-black uppercase tracking-[0.16em] text-white/80">{dateLabel}</div>
              <div className="text-[7px] font-black uppercase tracking-[0.14em] text-white/70">{weekdayLabel}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  labelClassName?: string;
  colorClassName?: string;
}

function ProgressRing({ percent, size = 70, strokeWidth = 8, labelClassName = "text-slate-800", colorClassName = "text-slate-700" }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * percent) / 100;
  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148,163,184,0.25)" strokeWidth={strokeWidth} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" strokeDasharray={circumference} strokeDashoffset={dashOffset} className={`transition-all duration-500 ${colorClassName}`} />
      </svg>
      <div className={`absolute text-sm font-black ${labelClassName}`}>{percent}%</div>
    </div>
  );
}

interface AttendanceCardProps {
  attendanceStats: { rate: number; presents: number; total: number };
  attendanceTodayBadge: string;
  attendanceTodayLabel: string;
  weeklyAttendance: Array<{ label: string; key: string; status: "present" | "absent" | "holiday" | "hidden" | "na" }>;
  attendanceStreak: number;
  currentMonthAttendanceCount: number;
  lastAttendanceDate: string | null;
  formatDate: (value?: string) => string;
  onOpenSheet: () => void;
}

function AttendanceCard({ attendanceStats, weeklyAttendance, onOpenSheet }: AttendanceCardProps) {
  const displayEntries = weeklyAttendance.filter((entry) => entry.status !== "hidden");
  return (
    <div className="relative flex flex-col justify-between h-full overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 sm:p-4 shadow-none">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <CalendarDays className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-600">Attendance</p>
              <p className="mt-0.5 truncate text-[11px] sm:text-xs font-semibold tracking-tight text-slate-900">Weekly overview</p>
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onOpenSheet(); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-300 hover:bg-slate-100" aria-label="Open attendance history">
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2.5">
          <p className="text-2xl sm:text-3xl font-black tracking-tight text-emerald-700">{attendanceStats.rate}%</p>
          <p className="text-[10px] font-bold text-slate-500 mt-0.5">{attendanceStats.presents}/{attendanceStats.total} classes</p>
        </div>
      </div>

      <div className="mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-2 sm:p-3 flex-1 flex flex-col justify-center min-h-[92px]">
        {displayEntries.length > 0 && (
          <div className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mb-1 text-center">
            {new Date(`${displayEntries[Math.floor(displayEntries.length / 2)].key}T12:00:00`).toLocaleDateString("en-IN", { month: "long" })}
          </div>
        )}
        <div className="grid grid-cols-7 gap-1">
          {displayEntries.slice(0, 7).map((entry) => {
            const isPresent = entry.status === "present";
            const isAbsent = entry.status === "absent";
            const isHoliday = entry.status === "holiday";
            const entryDate = new Date(`${entry.key}T12:00:00`);
            const dayLabel = entryDate.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 3).toUpperCase();
            const dateLabel = entryDate.getDate();
            return (
              <div key={entry.key} className="flex flex-col items-center text-center">
                <div className="text-[7px] font-black uppercase tracking-tight text-slate-400">{dayLabel}</div>
                <div className="mt-0.5 text-[9px] font-black text-slate-700">{dateLabel}</div>
                <div className={`mt-1 flex h-4.5 w-4.5 sm:h-5 sm:w-5 items-center justify-center rounded-full border text-[8px] font-black ${isPresent ? "border-emerald-200 bg-emerald-100 text-emerald-700" : isAbsent ? "border-red-500 bg-red-50 text-red-600 font-black text-[11px] sm:text-[12px] shadow-xs" : "border-slate-200 bg-slate-100 text-slate-400"}`}>
                  {isPresent ? "✓" : isAbsent ? "✕" : "NA"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface FeeCardProps {
  student: Student;
  currentMonthName: string;
  currentMonthStatus: string;
  pendingMonths: string[];
  totalPendingAmount: number;
  paidAcademicYearAmount: number;
  lastPaymentDate: string | null;
  onOpenSheet: () => void;
}

function FeeCard({ student, currentMonthName, currentMonthStatus, pendingMonths, totalPendingAmount, onOpenSheet }: FeeCardProps) {
  const today = new Date();
  const isAfterMonthEnd = today.getDate() >= 28;
  const feeStatusLabel = currentMonthStatus === "paid" ? "Paid" : currentMonthStatus === "na" ? "" : currentMonthStatus === "upcoming" || !isAfterMonthEnd ? "Upcoming" : "Pending";
  return (
    <div className="relative flex flex-col justify-between h-full overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 sm:p-4 shadow-none">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
              <CreditCard className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-600">Fees</p>
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onOpenSheet(); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-300 hover:bg-slate-100" aria-label="Open fee history">
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2.5">
          <p className="text-2xl sm:text-3xl font-black tracking-tight text-orange-600">₹{student.monthlyFee}<span className="text-[10px] font-semibold">/mo</span></p>
          {feeStatusLabel !== "Upcoming" && feeStatusLabel !== "" && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
              <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em] ${feeStatusLabel === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>{feeStatusLabel}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-[18px] border border-orange-100 bg-orange-50 p-2 sm:p-3 flex-1 flex flex-col justify-center min-h-[92px]">
        <div className="flex flex-col gap-2 text-[10px] sm:text-[11.5px] text-slate-700 w-full">
          <div className="flex items-center justify-between w-full min-w-0">
            <span className="flex items-center gap-1.5 text-slate-600 min-w-0 flex-1">
              <ReceiptText className="h-3.5 w-3.5 text-orange-600 shrink-0" />
              <span className="truncate">Pending Months</span>
            </span>
            <span className="font-black text-slate-900 text-right shrink-0 ml-2">{pendingMonths.length}</span>
          </div>
          <div className="flex items-center justify-between w-full min-w-0">
            <span className="flex items-center gap-1.5 text-slate-600 min-w-0 flex-1">
              <IndianRupee className="h-3.5 w-3.5 text-orange-600 shrink-0" />
              <span className="whitespace-nowrap">Pending Amount</span>
            </span>
            <span className="font-black text-slate-900 text-right shrink-0 ml-2">₹{totalPendingAmount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AttendanceBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  attendanceStats: { rate: number; presents: number; total: number };
  attendanceHistoryByMonth: Array<{ month: string; present: number; absent: number; total: number; pct: number }>;
  student: Student;
  selectedMonthLabel: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
}

function AttendanceBottomSheet({
  isOpen,
  onClose,
  attendanceStats,
  attendanceHistoryByMonth,
  student,
  selectedMonthLabel,
  onPreviousMonth,
  onNextMonth,
  canGoPrevious,
  canGoNext
}: AttendanceBottomSheetProps) {
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);

  const targetDate = React.useMemo(() => {
    const [monthName, yearStr] = (selectedMonthLabel || "").split(" ");
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    const year = Number(yearStr) || new Date().getFullYear();
    if (monthIndex === -1) return new Date();
    return new Date(year, monthIndex, 1);
  }, [selectedMonthLabel]);
  const calendarDays = React.useMemo(() => getCalendarDaysForCurrentMonth(student, targetDate), [student, targetDate]);
  const selectedMonthSummary = attendanceHistoryByMonth.find((item) => item.month === selectedMonthLabel);

  const handleSheetTouchStart = (event: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(event.touches[0].clientX);
  };

  const handleSheetTouchMove = (event: React.TouchEvent) => {
    setTouchEndX(event.touches[0].clientX);
  };

  const handleSheetTouchEnd = () => {
    if (touchStartX === null || touchEndX === null) return;
    const distance = touchStartX - touchEndX;
    if (distance > 50 && canGoNext) {
      onNextMonth();
    } else if (distance < -50 && canGoPrevious) {
      onPreviousMonth();
    }
    setTouchStartX(null);
    setTouchEndX(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="w-full max-w-lg overflow-hidden rounded-[30px] border border-slate-200/70 bg-white shadow-2xl" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={(event) => event.stopPropagation()} onTouchStart={handleSheetTouchStart} onTouchMove={handleSheetTouchMove} onTouchEnd={handleSheetTouchEnd}>
            <div className="flex items-start justify-between border-b border-slate-100 p-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Attendance history</p>
              </div>
            </div>
            <div className="max-h-[78vh] overflow-y-auto p-4">
              <div className="mt-1 flex items-center justify-between rounded-[22px] border border-slate-100 bg-slate-50 px-3 py-2">
                <button onClick={onPreviousMonth} disabled={!canGoPrevious} className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-black text-slate-700">{selectedMonthLabel || "Current month"}</span>
                <button onClick={onNextMonth} disabled={!canGoNext} className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4">
                <div className="rounded-[22px] border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Monthly summary</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">Present {selectedMonthSummary?.present ?? attendanceStats.presents}</span>
                    <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">Absent {selectedMonthSummary?.absent ?? (attendanceStats.total - attendanceStats.presents)}</span>
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700">No class 0</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-2">
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => (
                  <div key={day} className="text-center text-[8px] sm:text-[10px] font-black uppercase tracking-[0.1em] sm:tracking-[0.2em] text-slate-400">{day}</div>
                ))}
                {calendarDays.map((item) => {
                  const isPresent = item.status === "present";
                  const isAbsent = item.status === "absent";
                  const isHoliday = item.status === "holiday";
                  const isNone = item.status === "none";
                  const isNa = item.status === "na";
                  return (
                    <div key={item.key} className={`rounded-[12px] sm:rounded-2xl border p-1 sm:p-2 text-center text-[10px] sm:text-[11px] font-black ${isPresent ? "border-emerald-200 bg-emerald-100 text-emerald-700" : isAbsent ? "border-rose-200 bg-rose-100 text-rose-700" : isHoliday ? "border-slate-200 bg-slate-100 text-slate-600" : isNa ? "border-slate-200 bg-white text-slate-600" : isNone ? "border-transparent bg-transparent text-transparent" : "border-slate-200 bg-white text-slate-500"}`}>
                      {item.value || ""}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface FeeHistoryBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  feeHistory: Array<{ month: string; status: string; payDate?: string; paymentMode?: string }>;
  student: Student;
  formatDate: (value?: string) => string;
}

function FeeHistoryBottomSheet({ isOpen, onClose, feeHistory, student, formatDate }: FeeHistoryBottomSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-[30px] border border-slate-200/70 bg-white p-4 shadow-2xl" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Fee ledger</p>
                <h3 className="text-lg font-black text-slate-900">Fee history</h3>
              </div>
            </div>
            <div className="mt-4 max-h-[66vh] overflow-y-auto pr-1">
              <div className="flex flex-col gap-2">
                {feeHistory.map((item) => {
                  const paymentModeMeta = getPaymentModeMeta(item.paymentMode);
                  return (
                    <div key={item.month} className="rounded-[22px] border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-slate-800">{item.month}</p>
                          <p className="mt-1 text-[11px] text-slate-500">Amount: ₹{student.monthlyFee}</p>
                          <p className="text-[11px] text-slate-500">Paid date: {item.payDate ? formatDate(item.payDate) : "—"}</p>
                          <div className="mt-1 flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">
                            {paymentModeMeta.icon}
                            <span>{paymentModeMeta.label}</span>
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${item.status === "paid" ? "bg-emerald-100 text-emerald-700" : item.status === "na" ? "bg-slate-200 text-slate-700" : "bg-rose-100 text-rose-700"}`}>
                          {item.status === "paid" ? "Paid" : item.status === "na" ? "Not Due" : "Pending"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubjectPieChart({ rate, size = 32 }: { rate: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (rate / 100) * circumference;
  return (
    <div className="relative flex items-center justify-center shrink-0">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-white/20 fill-none"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-white fill-none transition-all duration-500"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-[8px] font-black text-white">{rate}%</div>
    </div>
  );
}

interface SubjectProgressCardProps {
  subject: { name: string; total: number; completed: number; rate: number; notes: ChapterNote[] };
  index: number;
  onSelectSubject: (subject: string) => void;
  student: Student;
}

function SubjectProgressCard({ subject, index, onSelectSubject, student }: SubjectProgressCardProps) {
  const palette = getSubjectCardPalette(subject.name, index);
  const IconComponent = getSubjectIcon(subject.name, index);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="col-span-1"
    >
      <button
        type="button"
        onClick={() => onSelectSubject(subject.name)}
        className={`group relative flex w-full items-center justify-between overflow-hidden rounded-[20px] border border-white/10 bg-gradient-to-br ${palette.shell} p-3 text-white transition-transform hover:-translate-y-0.5 shadow-none`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_30%)]" />
        
        <div className="relative flex items-center gap-2.5 min-w-0 flex-1 pr-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <IconComponent className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 text-left">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-white/90">{subject.name}</p>
            <p className="mt-0.5 text-xs font-bold text-white/85">{subject.completed}/{subject.total} Chapters</p>
          </div>
        </div>

        <div className="relative shrink-0 flex items-center gap-2.5">
          <SubjectPieChart rate={subject.rate} />
        </div>
      </button>
    </motion.div>
  );
}

export function getSubjectColor(subject: string): SubjectColorPalette {
  const norm = subject.trim().toLowerCase();
  
  const colors: Record<string, SubjectColorPalette> = {
    mathematics: {
      from: "from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      text: "text-blue-600 dark:text-blue-400",
      darkText: "text-blue-900 dark:text-blue-200",
      accent: "bg-blue-500 border-blue-200 dark:border-blue-900/50",
      ring: "text-blue-600 dark:text-blue-400",
      badge: "bg-blue-100 dark:bg-blue-900/50",
      badgeText: "text-blue-800 dark:text-blue-200"
    },
    english: {
      from: "from-indigo-500/10 to-violet-500/10 dark:from-indigo-500/20 dark:to-violet-500/20",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
      text: "text-indigo-600 dark:text-indigo-400",
      darkText: "text-indigo-900 dark:text-indigo-200",
      accent: "bg-indigo-500 border-indigo-200 dark:border-indigo-900/50",
      ring: "text-indigo-600 dark:text-indigo-400",
      badge: "bg-indigo-100 dark:bg-indigo-900/50",
      badgeText: "text-indigo-800 dark:text-indigo-200"
    },
    science: {
      from: "from-green-500/10 to-emerald-500/10 dark:from-green-500/20 dark:to-emerald-500/20",
      bg: "bg-green-50 dark:bg-green-950/30",
      text: "text-green-600 dark:text-green-400",
      darkText: "text-green-900 dark:text-green-200",
      accent: "bg-green-500 border-green-200 dark:border-green-900/50",
      ring: "text-green-600 dark:text-green-400",
      badge: "bg-green-100 dark:bg-green-900/50",
      badgeText: "text-green-800 dark:text-green-200"
    },
    physics: {
      from: "from-purple-500/10 to-fuchsia-500/10 dark:from-purple-500/20 dark:to-fuchsia-500/20",
      bg: "bg-purple-50 dark:bg-purple-950/30",
      text: "text-purple-600 dark:text-purple-400",
      darkText: "text-purple-900 dark:text-purple-200",
      accent: "bg-purple-500 border-purple-200 dark:border-purple-900/50",
      ring: "text-purple-600 dark:text-purple-400",
      badge: "bg-purple-100 dark:bg-purple-900/50",
      badgeText: "text-purple-800 dark:text-purple-200"
    },
    chemistry: {
      from: "from-orange-500/10 to-amber-500/10 dark:from-orange-500/20 dark:to-orange-500/20",
      bg: "bg-orange-50 dark:bg-orange-950/30",
      text: "text-orange-650 dark:text-orange-400",
      darkText: "text-orange-900 dark:text-orange-200",
      accent: "bg-orange-500 border-orange-200 dark:border-orange-900/50",
      ring: "text-orange-600 dark:text-orange-400",
      badge: "bg-orange-100 dark:bg-orange-900/50",
      badgeText: "text-orange-800 dark:text-orange-200"
    },
    biology: {
      from: "from-teal-500/10 to-cyan-500/10 dark:from-teal-500/20 dark:to-cyan-500/20",
      bg: "bg-teal-50 dark:bg-teal-950/30",
      text: "text-teal-600 dark:text-teal-400",
      darkText: "text-teal-900 dark:text-teal-200",
      accent: "bg-teal-500 border-teal-200 dark:border-teal-900/50",
      ring: "text-teal-600 dark:text-teal-400",
      badge: "bg-teal-100 dark:bg-teal-900/50",
      badgeText: "text-teal-800 dark:text-teal-200"
    },
    history: {
      from: "from-amber-500/10 to-yellow-500/10 dark:from-amber-500/20 dark:to-yellow-500/20",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      text: "text-amber-600 dark:text-amber-450",
      darkText: "text-amber-900 dark:text-amber-200",
      accent: "bg-amber-500 border-amber-200 dark:border-amber-900/50",
      ring: "text-amber-600 dark:text-amber-400",
      badge: "bg-amber-100 dark:bg-amber-900/50",
      badgeText: "text-amber-850 dark:text-amber-200"
    },
    geography: {
      from: "from-cyan-500/10 to-sky-500/10 dark:from-cyan-500/20 dark:to-sky-500/20",
      bg: "bg-cyan-50 dark:bg-cyan-950/30",
      text: "text-cyan-600 dark:text-cyan-400",
      darkText: "text-cyan-900 dark:text-cyan-200",
      accent: "bg-cyan-500 border-cyan-200 dark:border-cyan-900/50",
      ring: "text-cyan-600 dark:text-cyan-400",
      badge: "bg-cyan-100 dark:bg-cyan-900/50",
      badgeText: "text-cyan-800 dark:text-cyan-200"
    },
    "political science": {
      from: "from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20",
      bg: "bg-violet-50 dark:bg-violet-950/30",
      text: "text-violet-600 dark:text-violet-400",
      darkText: "text-violet-900 dark:text-violet-200",
      accent: "bg-violet-500 border-violet-200 dark:border-violet-900/50",
      ring: "text-violet-600 dark:text-violet-400",
      badge: "bg-violet-100 dark:bg-violet-900/50",
      badgeText: "text-violet-800 dark:text-violet-200"
    },
    economics: {
      from: "from-emerald-500/10 to-green-500/10 dark:from-emerald-500/20 dark:to-green-500/20",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      text: "text-emerald-600 dark:text-emerald-400",
      darkText: "text-emerald-900 dark:text-emerald-200",
      accent: "bg-emerald-500 border-emerald-200 dark:border-emerald-900/50",
      ring: "text-emerald-600 dark:text-emerald-400",
      badge: "bg-emerald-100 dark:bg-emerald-900/50",
      badgeText: "text-emerald-800 dark:text-emerald-200"
    },
    "computer science": {
      from: "from-blue-900/10 to-indigo-900/10 dark:from-blue-900/20 dark:to-indigo-900/20",
      bg: "bg-blue-50 dark:bg-blue-950/20",
      text: "text-blue-700 dark:text-blue-300",
      darkText: "text-blue-900 dark:text-blue-100",
      accent: "bg-blue-900 border-blue-300 dark:border-blue-900",
      ring: "text-blue-800 dark:text-blue-400",
      badge: "bg-blue-100 dark:bg-blue-900/50",
      badgeText: "text-blue-800 dark:text-blue-200"
    },
    hindi: {
      from: "from-amber-600/10 to-red-500/10 dark:from-amber-600/20 dark:to-red-500/20",
      bg: "bg-amber-50/40 dark:bg-amber-950/25",
      text: "text-amber-700 dark:text-amber-400",
      darkText: "text-amber-950 dark:text-amber-250",
      accent: "bg-amber-500 border-amber-200 dark:border-amber-900",
      ring: "text-amber-600 dark:text-amber-400",
      badge: "bg-amber-100 dark:bg-amber-900/50",
      badgeText: "text-amber-800 dark:text-amber-200"
    },
    nepali: {
      from: "from-red-500/10 to-rose-500/10 dark:from-red-500/20 dark:to-rose-500/20",
      bg: "bg-red-50 dark:bg-red-950/30",
      text: "text-red-600 dark:text-red-450",
      darkText: "text-red-900 dark:text-red-200",
      accent: "bg-red-500 border-red-200 dark:border-red-900/50",
      ring: "text-red-600 dark:text-red-400",
      badge: "bg-red-100 dark:bg-red-900/50",
      badgeText: "text-red-800 dark:text-red-200"
    }
  };

  if (colors[norm]) return colors[norm];
  const found = Object.keys(colors).find(key => norm.includes(key));
  if (found) return colors[found];

  const list = Object.values(colors);
  const index = subject.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % list.length;
  return list[index];
}

export function getSubjectIcon(subject: string, index?: number) {
  const norm = subject.toLowerCase().trim();
  
  if (norm.includes("mathematics") || norm.includes("math")) return Calculator;
  if (norm.includes("environmental science") || norm.includes("evs") || norm.includes("environment")) return Leaf;
  if (norm.includes("computer science") || norm.includes("computer") || norm.includes("code") || norm.includes("coding") || norm.includes("laptop")) return Laptop;
  if (norm.includes("physics")) return Magnet;
  if (norm.includes("chemistry")) return Beaker;
  if (norm.includes("biology")) return Dna;
  if (norm.includes("science") && !norm.includes("social") && !norm.includes("political")) return Atom;
  if (norm.includes("english")) return Languages;
  if (norm.includes("hindi")) return BookOpen;
  if (norm.includes("economics") || norm.includes("economic")) return LineChart;
  if (norm.includes("accountancy") || norm.includes("accounting")) return Book;
  if (norm.includes("business studies") || norm.includes("business")) return Briefcase;
  if (norm.includes("history")) return Scroll;
  if (norm.includes("geography")) return Globe;
  if (norm.includes("polity") || norm.includes("political science") || norm.includes("political") || norm.includes("constitution") || norm.includes("governance")) return Landmark;
  if (norm.includes("ethics") || norm.includes("integrity")) return Scale;
  if (norm.includes("international relations") || norm.includes("ir") || norm.includes("international")) return Globe;
  if (norm.includes("current affairs") || norm.includes("current")) return FileText;
  if (norm.includes("science & tech") || norm.includes("science and tech") || norm.includes("technology")) return Cpu;
  if (norm.includes("civics")) return Scale;
  if (norm.includes("indian heritage") || norm.includes("culture") || norm.includes("heritage")) return Landmark;
  if (norm.includes("art")) return Palette;
  if (norm.includes("music")) return Music;
  if (norm.includes("physical education") || norm.includes("pe") || norm.includes("sports")) return Dumbbell;
  if (norm.includes("general knowledge") || norm.includes("gk")) return Lightbulb;
  if (norm.includes("commerce")) return ShoppingBag;
  if (norm.includes("sanskrit")) return BookOpen;
  if (norm.includes("psychology")) return Brain;
  if (norm.includes("statistics") || norm.includes("stats")) return PieChart;
  if (norm.includes("social")) return Users;

  const fallbackIcons = [BookOpen, Cpu, Atom, FlaskConical, Dna, Microscope, Scroll, Languages, Calculator, Landmark];
  if (index !== undefined) {
    return fallbackIcons[index % fallbackIcons.length];
  }
  return BookOpen;
}

export function StudentMyTab({ 
  student, 
  initialSubject, 
  onSelectSubject, 
  onUpdateChapterRemark,
  onDeleteNote,
  onUpdateStudent,
  isAdmin = false
}: { 
  student: Student; 
  initialSubject?: string | null;
  onSelectSubject?: (subject: string) => void;
  onUpdateChapterRemark: (subject: string, noteId: string, remark: string) => void; 
  onDeleteNote?: (subject: string, noteId: string) => void;
  onUpdateStudent?: (student: Student) => void;
  isAdmin?: boolean;
}) {
  const [localStudent, setLocalStudent] = useState<Student>(student);
  const [allClassNotes, setAllClassNotes] = useState<ClassNote[]>(() => getLocalClassNotes());

  React.useEffect(() => {
    setLocalStudent((prev) => {
      if (
        prev.id === student.id &&
        prev.classGrade === student.classGrade &&
        prev.name === student.name &&
        prev.serviceStatus === student.serviceStatus &&
        prev.service_status === student.service_status &&
        JSON.stringify(prev.enrolledSubjects || []) === JSON.stringify(student.enrolledSubjects || []) &&
        JSON.stringify(prev.notes || {}) === JSON.stringify(student.notes || {}) &&
        JSON.stringify(prev.chapterProgress || {}) === JSON.stringify(student.chapterProgress || {})
      ) {
        return prev;
      }
      return student;
    });
  }, [student]);

  React.useEffect(() => {
    const unsub = subscribeToClassNotes((notes) => {
      if (!Array.isArray(notes)) return;
      setAllClassNotes((prev) => (areClassNotesEqual(prev, notes) ? prev : notes));
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const sortedSubjects = useMemo(() => {
    return getStudentSubjects(localStudent, allClassNotes);
  }, [localStudent, allClassNotes]);

  const [selectedSubject, setSelectedSubject] = useState<string | null>(() => {
    return initialSubject || getStudentSubjects(localStudent, allClassNotes)[0] || null;
  });
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null);
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
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
  const [openingNoteId, setOpeningNoteId] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [progressModalNote, setProgressModalNote] = useState<ChapterNote | null>(null);
  const [reportModalData, setReportModalData] = useState<SubjectReportData | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // Delete note state
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{ subject: string; noteId: string } | null>(null);
  const [isDeletingNote, setIsDeletingNote] = useState(false);

  // Practice test modal state
  const [studentTestTarget, setStudentTestTarget] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    testType: "topic" | "full_chapter";
  } | null>(null);

  const [, setTestBankVersion] = useState(0);

  useEffect(() => {
    fetchAllPracticeTestsFromSupabase();
    if (student?.id) {
      fetchStudentTestAttemptsFromSupabase(student.id, student.name);
    }

    const handlePracticeTestsUpdate = () => {
      // Refresh the test bank from Supabase to ensure deleted tests are removed
      fetchAllPracticeTestsFromSupabase();
      if (student?.id) {
        fetchStudentTestAttemptsFromSupabase(student.id, student.name);
      }
      setTestBankVersion((v) => v + 1);
    };

    const handleOtherUpdate = () => {
      setTestBankVersion((v) => v + 1);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("practice-tests-updated", handlePracticeTestsUpdate);
      window.addEventListener("test-attempts-updated", handleOtherUpdate);
      window.addEventListener("storage", handleOtherUpdate);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("practice-tests-updated", handlePracticeTestsUpdate);
        window.removeEventListener("test-attempts-updated", handleOtherUpdate);
        window.removeEventListener("storage", handleOtherUpdate);
      }
    };
  }, [selectedSubject, localStudent]);

  const handleSaveChapterProgress = async (status: string, remarks: string) => {
    if (!progressModalNote || !selectedSubject) return;
    const subjClean = selectedSubject.trim();
    const keyWithSubject = `${subjClean}_${progressModalNote.id}`;
    const keyRawSubject = `${selectedSubject}_${progressModalNote.id}`;
    const keyNoteOnly = progressModalNote.id;
    const config = getStatusConfig(status);

    const newRecord: ChapterProgressData = {
      studentId: localStudent.id,
      subjectId: subjClean,
      chapterId: progressModalNote.id,
      selectedStatus: status,
      calculatedProgress: config.percent,
      remarks,
      updatedAt: new Date().toISOString()
    };

    const updatedChapterProgress = {
      ...(localStudent.chapterProgress || {}),
      [keyWithSubject]: newRecord,
      [keyRawSubject]: newRecord,
      [keyNoteOnly]: newRecord
    };

    const currentNotes = (localStudent.notes?.[selectedSubject] || localStudent.notes?.[subjClean] || []) as ChapterNote[];
    const updatedNotes = currentNotes.map((n) => {
      if (n.id === progressModalNote.id) {
        return {
          ...n,
          isCompleted: config.percent === 100,
          remark: remarks ? remarks : n.remark
        };
      }
      return n;
    });

    const updatedStudent: Student = {
      ...localStudent,
      notes: {
        ...(localStudent.notes || {}),
        [selectedSubject]: updatedNotes,
        [subjClean]: updatedNotes
      },
      chapterProgress: updatedChapterProgress
    };

    setLocalStudent(updatedStudent);

    try {
      if (onUpdateStudent) {
        await onUpdateStudent(updatedStudent);
      } else {
        await saveStudentDoc(updatedStudent);
      }
    } catch (err) {
      console.error("Failed to persist student record:", err);
    } finally {
      setProgressModalNote(null);
    }
  };

  React.useEffect(() => {
    if (initialSubject && sortedSubjects.includes(initialSubject)) {
      setSelectedSubject(initialSubject);
    } else if (sortedSubjects.length > 0) {
      if (!selectedSubject || !sortedSubjects.includes(selectedSubject)) {
        setSelectedSubject(sortedSubjects[0]);
      }
    } else {
      setSelectedSubject(null);
    }
  }, [initialSubject, sortedSubjects]);

  const handleSelectSubject = (subject: string) => {
    setSelectedSubject(subject);
    if (onSelectSubject) {
      onSelectSubject(subject);
    }
  };

  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [expandedStudentChapters, setExpandedStudentChapters] = useState<Record<number, boolean>>({});

  const toggleStudentChapterExpand = (chNo: number) => {
    setExpandedStudentChapters((prev) => ({
      ...prev,
      [chNo]: !prev[chNo]
    }));
  };

  // Filter notes from central repository matching student's class and enrolled subjects
  const studentClassNotes = useMemo(() => {
    return filterClassNotesForStudent(allClassNotes, localStudent);
  }, [allClassNotes, localStudent]);

  const selectedNotes = useMemo(() => {
    if (!selectedSubject) return [] as ChapterNote[];

    const fromClassNotes: ChapterNote[] = studentClassNotes
      .filter((n) => isSubjectMatching(n.subject, selectedSubject))
      .map((cn) => ({
        id: cn.id,
        classGrade: cn.classGrade,
        subject: cn.subject,
        chapterNo: cn.chapterNo,
        chapterName: cn.chapterName,
        partLabel: cn.partLabel,
        topicNo: cn.topicNo,
        topicName: cn.topicName,
        pdfUrl: cn.pdfUrl,
        pdfFileName: cn.pdfFileName,
        storagePath: cn.storagePath,
        bucket: cn.bucket,
        fileType: cn.fileType,
        mimeType: cn.mimeType,
        createdAt: cn.createdAt,
        accessType: cn.accessType,
        allowedStudentIds: cn.allowedStudentIds,
        allowedClasses: cn.allowedClasses,
      }));

    // Fallback: Also include any notes directly under student object if not already present
    let legacyRaw: ChapterNote[] = [];
    if (localStudent.notes) {
      for (const [k, v] of Object.entries(localStudent.notes)) {
        if (isSubjectMatching(k, selectedSubject) && Array.isArray(v)) {
          legacyRaw = [...legacyRaw, ...v];
        }
      }
    }
    const legacyFiltered = filterNotesForStudent(legacyRaw, localStudent.id, isAdmin);

    const combined = [...fromClassNotes];
    for (const leg of legacyFiltered) {
      if (!combined.some((c) => c.id === leg.id || (leg.storagePath && c.storagePath === leg.storagePath))) {
        combined.push(leg);
      }
    }

    return combined;
  }, [selectedSubject, studentClassNotes, localStudent.notes, localStudent.id, isAdmin]);

  const selectedChapterGroups = useMemo(() => {
    if (!selectedSubject) return [];

    const query = noteSearchQuery.trim().toLowerCase();
    const filtered = query
      ? selectedNotes.filter((note) => {
          const matchSubj = (selectedSubject || "").toLowerCase().includes(query);
          const matchChNo = `chapter ${note.chapterNo}`.toLowerCase().includes(query) || `${note.chapterNo}`.includes(query);
          const matchChName = (note.chapterName || "").toLowerCase().includes(query);
          const matchPart = (note.partLabel || "").toLowerCase().includes(query);
          const matchFile = (note.pdfFileName || "").toLowerCase().includes(query);
          return matchSubj || matchChNo || matchChName || matchPart || matchFile;
        })
      : selectedNotes;

    return groupAndSortChapterNotes(filtered);
  }, [selectedSubject, selectedNotes, noteSearchQuery]);

  const handleSaveRemark = (note: ChapterNote) => {
    const draft = (remarkDrafts[note.id] ?? note.remark ?? "").trim();
    onUpdateChapterRemark(selectedSubject || "", note.id, draft);
    setEditingRemarkId(null);
  };

  const currentTabServiceStatus = (localStudent.serviceStatus || localStudent.service_status || "active").toLowerCase();

  const handlePreviewPdf = (note: ChapterNote) => {
    // Single Tap Protection: Ignore taps while a note is currently opening/downloading
    if (openingNoteId || activePreviewPdf) return;

    if (!isAdmin) {
      if (currentTabServiceStatus === "paused") {
        alert("Your learning services are temporarily paused. Please contact the academy for assistance.");
        return;
      }
      if (currentTabServiceStatus === "ended") {
        alert("Your academy services have ended. Please contact the administrator if you believe this is an error.");
        return;
      }
    }
    if (!note.pdfUrl && !note.storagePath) return;

    setOpeningNoteId(note.id);

    let url = note.pdfUrl || "";
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
    if (localStudent?.id) {
      updateStudentPresence(localStudent.id);
    }
    const topicFormatted = getFormattedTopicLabel(note);
    const title = topicFormatted || `Chapter ${note.chapterNo} – ${note.chapterName}`;

    setActivePreviewPdf({
      url,
      title,
      noteId: note.id,
      storagePath: storagePath || url,
      bucket: bucket,
      fileName: note.pdfFileName || note.fileName,
      mimeType: note.mimeType,
      fileType: note.fileType
    });
  };

  const getFileSizeStr = (pdfUrl: string, chapterNo: number) => {
    if (pdfUrl.startsWith("data:")) {
      const base64Length = pdfUrl.length - (pdfUrl.indexOf(",") + 1);
      const sizeInBytes = Math.round(base64Length * 0.75);
      if (sizeInBytes > 1024 * 1024) {
        return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
      }
      return `${Math.round(sizeInBytes / 1024)} KB`;
    }
    const mockedKb = ((chapterNo * 420 + 280) % 1800) + 350;
    if (mockedKb > 1024) {
      return `${(mockedKb / 1024).toFixed(1)} MB`;
    }
    return `${mockedKb} KB`;
  };

  return (
    <div className="flex flex-col gap-4 animate-fadeIn" id="student-my-tab">
      <div className="rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-none dark:border-slate-800 dark:bg-slate-900/70" id="student-my-tab-header">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-600 dark:text-indigo-400">My Study Space</p>
          </div>
          <div className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            {sortedSubjects.length} Enrolled Subjects
          </div>
        </div>
      </div>

      {/* File Explorer Layout Grid */}
      <div className="grid grid-cols-1 min-[520px]:grid-cols-12 gap-4 min-h-[420px]" id="my-study-space-split-container">
        
        {/* LEFT PANEL (32% width on sm+ or 4/12 columns) */}
        <div className="col-span-12 min-[520px]:col-span-4 flex flex-col h-full overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border border-slate-100 dark:border-slate-800/80 p-4" id="split-left-panel">
          <div className="mb-4 shrink-0" id="study-left-header">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-600 dark:text-indigo-400">Enrolled Subjects</p>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 scrollbar-thin" id="study-left-subjects">
            {sortedSubjects.length === 0 ? (
              <div className="text-center py-8 px-3">
                <BookOpen className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2 stroke-[1.2]" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No Enrolled Subjects</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">No subjects assigned yet.</p>
              </div>
            ) : (
              sortedSubjects.map((subject, idx) => {
                const isActive = selectedSubject === subject;
                const palette = getSubjectColor(subject);
                const IconComponent = getSubjectIcon(subject, idx);
                return (
                  <button
                    key={subject}
                    onClick={() => handleSelectSubject(subject)}
                    className={`group rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      isActive 
                        ? `${palette.bg} border-blue-500 text-blue-700 dark:text-blue-400 shadow-sm` 
                        : "border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-950 hover:border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className={`p-1.5 rounded-lg ${isActive ? palette.badge : "bg-slate-50 dark:bg-slate-950 group-hover:bg-slate-100"}`}>
                        <IconComponent className={`h-3.5 w-3.5 ${isActive ? palette.text : "text-slate-400"}`} />
                      </div>
                      <span className="truncate">{subject}</span>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isActive ? "text-blue-500 translate-x-0.5" : "text-slate-350 opacity-0 group-hover:opacity-100"}`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL (68% width on sm+ or 8/12 columns) */}
        <div className="col-span-12 min-[520px]:col-span-8 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 shadow-xs" id="split-right-panel">
          {selectedSubject ? (
            <>
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-4 flex items-center justify-between shrink-0" id="study-right-header">
                <div className="truncate">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Selected Subject</p>
                  <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 truncate pr-2">{selectedSubject}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (!selectedSubject) return;
                      if (!isAdmin && currentTabServiceStatus === "ended") {
                        alert("Your academy services have ended. Please contact the administrator if you believe this is an error.");
                        return;
                      }
                      const allStudentAttempts = getStudentTestAttempts(localStudent.id || localStudent.name || "");
                      const rData = calculateSubjectTestProgress(selectedSubject, localStudent, allClassNotes, allStudentAttempts, isAdmin);
                      setReportModalData(rData);
                      setIsReportModalOpen(true);
                    }}
                    className="rounded-xl bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/70 disabled:opacity-50 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40 flex items-center gap-1.5 cursor-pointer transition active:scale-95 shrink-0"
                    title="View Subject Report"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden min-[400px]:inline">Report</span>
                  </button>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-850/60 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                    <span>{selectedChapterGroups.length} Chapters</span>
                  </div>
                </div>
              </div>

              {/* Search Bar for Notes */}
              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by subject, chapter number, or chapter name..."
                  value={noteSearchQuery}
                  onChange={(e) => setNoteSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                />
                {noteSearchQuery && (
                  <button
                    onClick={() => setNoteSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 scrollbar-thin" id="study-right-notes">
                {selectedChapterGroups.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 my-auto border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/20 dark:bg-slate-950/10">
                    <div className="relative mb-4">
                      <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 dark:text-slate-500 shadow-xs">
                        <FileText className="w-10 h-10 stroke-[1.2]" />
                      </div>
                      <div className="absolute -bottom-1.5 -right-1.5 p-1 bg-amber-500 rounded-full text-white shadow-xs">
                        <AlertCircle className="w-4 h-4" />
                      </div>
                    </div>
                    <h4 className="text-sm font-black text-slate-750 dark:text-slate-200">
                      {noteSearchQuery ? "No matching chapters found." : "No notes are available for this subject."}
                    </h4>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-xs mt-1">
                      {noteSearchQuery ? "Try searching with a different term." : `Your tutor hasn't uploaded any PDF chapters for ${selectedSubject} yet. Please check back later.`}
                    </p>
                  </div>
                ) : (
                  selectedChapterGroups.map((group) => {
                    const chapterNotes = group.notes;
                    let completedParts = 0;
                    let startedParts = 0;
                    let chapterRemark = "";

                    chapterNotes.forEach((n) => {
                      const progRecord = getChapterProgressRecord(n.id, selectedSubject, localStudent.chapterProgress);
                      const statusConfig = progRecord ? getStatusConfig(progRecord.selectedStatus) : null;
                      const normStatus = progRecord?.selectedStatus ? normalizeStatusLabel(progRecord.selectedStatus) : "";
                      const isPartCompleted = normStatus === "Fully Prepared" || (statusConfig && statusConfig.category === "completed") || !!n.isCompleted;
                      const isPartStarted = isPartCompleted || (normStatus !== "" && normStatus !== "Not Started");
                      const rem = progRecord?.remarks || n.remark || "";

                      if (isPartCompleted) completedParts++;
                      if (isPartStarted) startedParts++;
                      if (rem && !chapterRemark) chapterRemark = rem;
                    });

                    const isChapterCompleted = chapterNotes.length > 0 && completedParts === chapterNotes.length;
                    let chapterStatusLabel = "Not Started";
                    if (isChapterCompleted) {
                      chapterStatusLabel = "Completed";
                    } else if (startedParts > 0 || completedParts > 0) {
                      chapterStatusLabel = "In Progress";
                    }

                    if (chapterNotes.length === 1) {
                      const note = chapterNotes[0];
                      const topicName = getFormattedTopicLabel(note) || `Topic ${group.chapterNo}`;
                      const topicTest = getTopicPracticeTest(
                        localStudent.classGrade || note.classGrade || "",
                        selectedSubject || note.subject || "",
                        group.chapterNo,
                        topicName
                      );
                      const hasTest = !!(topicTest && topicTest.questions && topicTest.questions.length > 0);

                      return (
                        <div 
                          key={`chapter-single-${group.chapterNo}-${note.id}`} 
                          className={`rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 hover:border-blue-300 dark:hover:border-blue-800 transition-all flex flex-col gap-3 group shadow-xs ${
                            openingNoteId === note.id ? "ring-2 ring-blue-500/50 pointer-events-none" : openingNoteId ? "pointer-events-none opacity-80" : ""
                          }`}
                        >
                          {/* Row 1: Book Icon & Chapter Title */}
                          <div 
                            className={`flex items-center gap-3 min-w-0 w-full cursor-pointer ${
                              openingNoteId ? "pointer-events-none" : ""
                            }`} 
                            onClick={() => handlePreviewPdf(note)}
                          >
                            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl shrink-0 border border-blue-100/60 dark:border-blue-900/30 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                              {openingNoteId === note.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                              ) : (
                                <BookOpen className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  Chapter {group.chapterNo} – {group.chapterName}
                                </h4>
                                {openingNoteId === note.id && (
                                  <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 animate-pulse">
                                    Opening...
                                  </span>
                                )}
                              </div>
                              {note.pdfFileName && (
                                <p className="text-[10px] font-semibold text-slate-400 truncate mt-0.5">
                                  {note.pdfFileName} {note.createdAt ? `• Added ${formatDate(note.createdAt)}` : ""}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Status Badge (left), Test Icon Button (right) */}
                          <div className="flex items-center justify-between gap-2.5 w-full pt-0.5">
                            <div className="flex items-center gap-2 shrink-0 min-w-0">
                              {isChapterCompleted && (
                                <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1 whitespace-nowrap shrink-0 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                  <CheckCircle2 className="w-2.5 h-2.5 stroke-[2.5]" />
                                  <span>Completed</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
                              {hasTest && (() => {
                                const studentClass = localStudent.classGrade || note.classGrade || "";
                                const studentSubj = selectedSubject || note.subject || "";
                                const allAttempts = getStudentTestAttempts(localStudent.id || localStudent.name || "");
                                const normTopic = (topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                const attempts = allAttempts.filter((a) => {
                                  if (a.chapterNo !== group.chapterNo) return false;
                                  const aClass = (a.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                  const sClass = (studentClass || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                  if (aClass && sClass && aClass !== sClass && !aClass.includes(sClass) && !sClass.includes(aClass)) return false;
                                  const aSubj = (a.subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                  const sSubj = (studentSubj || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                  if (aSubj && sSubj && aSubj !== sSubj && !aSubj.includes(sSubj) && !sSubj.includes(aSubj)) return false;
                                  const aNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                  return aNorm === normTopic || aNorm.includes(normTopic) || normTopic.includes(aNorm);
                                });
                                const bestScore = attempts.length > 0 ? Math.max(...attempts.map((a) => a.score)) : null;
                                const bestAttempt = attempts.find((a) => a.score === bestScore);
                                const totalQ = bestAttempt?.totalQuestions || topicTest?.questions?.length || 0;
                                const isAttempted = bestScore !== null;
                                const pct = isAttempted && totalQ > 0 ? Math.round((bestScore / totalQ) * 100) : null;
                                const btnStyles = getScoreButtonStyles(isAttempted, pct);

                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!isAdmin) {
                                        if (currentTabServiceStatus === "paused") {
                                          alert("Your learning services are temporarily paused. Please contact the academy for assistance.");
                                          return;
                                        }
                                        if (currentTabServiceStatus === "ended") {
                                          alert("Your academy services have ended. Please contact the administrator if you believe this is an error.");
                                          return;
                                        }
                                      }
                                      setStudentTestTarget({
                                        classGrade: studentClass,
                                        subject: studentSubj,
                                        chapterNo: group.chapterNo,
                                        chapterName: group.chapterName,
                                        topicName,
                                        testType: "topic"
                                      });
                                    }}
                                    className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer shadow-2xs shrink-0 flex items-center gap-2 font-extrabold min-w-[70px] whitespace-nowrap active:scale-95 ${btnStyles.container}`}
                                    title={isAttempted ? `Highest Score: ${bestScore}/${totalQ}` : "Take Practice Test"}
                                  >
                                    <FileCheck className={`w-4 h-4 shrink-0 ${btnStyles.icon}`} />
                                    {isAttempted ? (
                                      <div className="flex flex-col items-center justify-center text-center leading-none">
                                        <span className={`text-xs font-extrabold ${btnStyles.scoreText}`}>
                                          {bestScore}/{totalQ}
                                        </span>
                                        <span className={`text-[10px] font-bold mt-0.5 ${btnStyles.labelText}`}>
                                          Test
                                        </span>
                                      </div>
                                    ) : (
                                      <span className={`text-xs font-bold ${btnStyles.labelText}`}>
                                        Test
                                      </span>
                                    )}
                                  </button>
                                );
                              })()}
                            </div>
                          </div>

                          {/* Remark Display */}
                          {chapterRemark ? (
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 break-words">
                                <span className="font-bold text-slate-700 dark:text-slate-300">Remark:</span> {chapterRemark.split("\n")[0]}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    // Multiple PDFs in this Chapter (Collapsible Parent + Parts List)
                    const isExpanded = !!expandedStudentChapters[group.chapterNo];

                    return (
                      <div
                        key={`chapter-group-${group.chapterNo}`}
                        className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col overflow-hidden transition-all"
                      >
                        {/* Parent Chapter Header */}
                        <div className="p-3.5 flex flex-col gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-850/50 transition-colors group/hdr">
                          {/* Row 1: Expand Arrow, Book Icon, Chapter Title */}
                          <div 
                            className="flex items-center gap-3 min-w-0 w-full cursor-pointer"
                            onClick={() => toggleStudentChapterExpand(group.chapterNo)}
                            title="Click to expand/collapse chapter topics"
                          >
                            <div className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg group-hover/hdr:bg-blue-50 group-hover/hdr:text-blue-600 dark:group-hover/hdr:bg-blue-950/50 dark:group-hover/hdr:text-blue-400 transition-colors shrink-0">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </div>
                            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                              <BookOpen className="w-4 h-4" />
                            </div>
                            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 break-words flex-1 min-w-0 group-hover/hdr:text-blue-600 dark:group-hover/hdr:text-blue-400 transition-colors">
                              Chapter {group.chapterNo} – {group.chapterName}
                            </h4>
                          </div>

                          {/* Row 2: Status Badge (left), Topics Badge */}
                          <div className="flex items-center justify-between gap-2.5 w-full pt-0.5">
                            <div className="flex items-center gap-2 shrink-0 min-w-0">
                              {isChapterCompleted && (
                                <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1 whitespace-nowrap shrink-0 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                  <CheckCircle2 className="w-2.5 h-2.5 stroke-[2.5]" />
                                  <span>Completed</span>
                                </span>
                              )}

                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0">
                                {group.notes.length} {group.notes.length === 1 ? "Topic" : "Topics"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expanded Parts List */}
                        {isExpanded && (
                          <div className="p-3 pt-0 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-950/20 animate-fadeIn">
                            {group.notes.map((note) => {
                              const topicName = getFormattedTopicLabel(note) || `Topic ${group.chapterNo}`;
                              const topicTest = getTopicPracticeTest(
                                localStudent.classGrade || note.classGrade || "",
                                selectedSubject || note.subject || "",
                                group.chapterNo,
                                topicName
                              );
                              const hasTest = !!(topicTest && topicTest.questions && topicTest.questions.length > 0);

                              return (
                                <div
                                  key={note.id}
                                  onClick={() => handlePreviewPdf(note)}
                                  className={`p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-150/60 dark:border-slate-800/80 flex items-center justify-between gap-2.5 hover:border-blue-300 dark:hover:border-blue-800 transition-all cursor-pointer group ${
                                    openingNoteId === note.id ? "ring-2 ring-blue-500/50 pointer-events-none" : openingNoteId ? "pointer-events-none opacity-80" : ""
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {openingNoteId === note.id ? (
                                      <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                                    ) : (
                                      <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                                    )}
                                    <div className="flex flex-col min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                          {getFormattedTopicLabel(note)}
                                        </span>
                                        {openingNoteId === note.id && (
                                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 animate-pulse">
                                            Opening...
                                          </span>
                                        )}
                                      </div>
                                      {!isFileNameRedundant(getFormattedTopicLabel(note), note.pdfFileName) && note.pdfFileName ? (
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                          {note.pdfFileName} {note.createdAt ? `• Added ${formatDate(note.createdAt)}` : ""}
                                        </span>
                                      ) : note.createdAt ? (
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                          Added {formatDate(note.createdAt)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    {hasTest && (() => {
                                      const studentClass = localStudent.classGrade || note.classGrade || "";
                                      const studentSubj = selectedSubject || note.subject || "";
                                      const allAttempts = getStudentTestAttempts(localStudent.id || localStudent.name || "");
                                      const normTopic = (topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                      const attempts = allAttempts.filter(a => {
                                        if (a.chapterNo !== group.chapterNo) return false;
                                        if ((a.classGrade || "").toLowerCase().trim() !== (studentClass || "").toLowerCase().trim()) return false;
                                        if ((a.subject || "").toLowerCase().trim() !== (studentSubj || "").toLowerCase().trim()) return false;
                                        const aNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                                        return aNorm === normTopic || aNorm.includes(normTopic) || normTopic.includes(aNorm);
                                      });
                                      const bestScore = attempts.length > 0 ? Math.max(...attempts.map(a => a.score)) : null;
                                      const bestAttempt = attempts.find(a => a.score === bestScore);
                                      const totalQ = bestAttempt?.totalQuestions || topicTest?.questions?.length || 0;
                                      const isAttempted = bestScore !== null;
                                      const pct = isAttempted && totalQ > 0 ? Math.round((bestScore / totalQ) * 100) : null;
                                      const btnStyles = getScoreButtonStyles(isAttempted, pct);

                                      return (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setStudentTestTarget({
                                              classGrade: studentClass,
                                              subject: studentSubj,
                                              chapterNo: group.chapterNo,
                                              chapterName: group.chapterName,
                                              topicName,
                                              testType: "topic"
                                            });
                                          }}
                                          className={`px-3 py-1 rounded-xl border transition-all cursor-pointer shadow-2xs shrink-0 flex items-center gap-2 min-h-[38px] ${btnStyles.container}`}
                                          title={isAttempted ? `Highest Score: ${bestScore}/${totalQ}` : "Take Practice Test"}
                                        >
                                          <FileCheck className={`w-4 h-4 shrink-0 ${btnStyles.icon}`} />
                                          {isAttempted ? (
                                            <div className="flex flex-col items-center justify-center text-center leading-none">
                                              <span className={`text-xs font-extrabold ${btnStyles.scoreText}`}>
                                                {bestScore}/{totalQ}
                                              </span>
                                              <span className={`text-[10px] font-bold mt-0.5 ${btnStyles.labelText}`}>
                                                Test
                                              </span>
                                            </div>
                                          ) : (
                                            <span className={`text-xs font-bold ${btnStyles.labelText}`}>
                                              Test
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })()}

                                    {isAdmin && onDeleteNote && selectedSubject && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteNoteTarget({ subject: selectedSubject, noteId: note.id });
                                        }}
                                        className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
                                        title="Delete Note"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-sm text-slate-500 dark:text-slate-400">
              {sortedSubjects.length === 0 ? "No enrolled subjects assigned yet." : "Choose a subject to view chapter-wise notes."}
            </div>
          )}
        </div>

      </div>

      {/* Student Native PDF Modal */}
      {activePreviewPdf && (
        <PdfViewer
          key={`pdf-viewer-${activePreviewPdf.noteId || activePreviewPdf.storagePath || activePreviewPdf.url}`}
          url={activePreviewPdf.url}
          title={activePreviewPdf.title}
          onClose={() => {
            setActivePreviewPdf(null);
            setOpeningNoteId(null);
          }}
          noteId={activePreviewPdf.noteId}
          storagePath={activePreviewPdf.storagePath}
          bucket={activePreviewPdf.bucket}
          fileName={activePreviewPdf.fileName}
          mimeType={activePreviewPdf.mimeType}
          fileType={activePreviewPdf.fileType}
        />
      )}

      {/* Chapter Progress Bottom Sheet / Modal */}
      {progressModalNote && selectedSubject && (
        <ChapterProgressBottomSheet
          note={progressModalNote}
          subject={selectedSubject}
          initialProgress={getChapterProgressRecord(progressModalNote.id, selectedSubject, localStudent.chapterProgress)}
          onClose={() => setProgressModalNote(null)}
          onSave={(status, remarks) => handleSaveChapterProgress(status, remarks)}
        />
      )}

      {/* Subject Report Modal */}
      <SubjectReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        reportData={reportModalData}
        studentName={localStudent.name}
        classGrade={localStudent.classGrade}
      />

      {/* Student Practice Test Modal */}
      {studentTestTarget && (
        <StudentPracticeTestModal
          isOpen={true}
          onClose={() => setStudentTestTarget(null)}
          studentId={localStudent.id}
          studentName={localStudent.name}
          classGrade={studentTestTarget.classGrade}
          subject={studentTestTarget.subject}
          chapterNo={studentTestTarget.chapterNo}
          chapterName={studentTestTarget.chapterName}
          topicName={studentTestTarget.topicName}
          testType={studentTestTarget.testType}
          serviceStatus={localStudent.serviceStatus || localStudent.service_status}
        />
      )}

      {/* --- CONFIRM DELETE NOTE MODAL --- */}
      <ConfirmDeleteModal
        isOpen={!!deleteNoteTarget}
        isDeleting={isDeletingNote}
        onCancel={() => {
          if (!isDeletingNote) setDeleteNoteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteNoteTarget || !onDeleteNote) return;
          try {
            setIsDeletingNote(true);
            await onDeleteNote(deleteNoteTarget.subject, deleteNoteTarget.noteId);
            setDeleteNoteTarget(null);
          } catch (err: any) {
            console.error(err);
            alert("Unable to delete note. Please try again.");
          } finally {
            setIsDeletingNote(false);
          }
        }}
      />
    </div>
  );
}

export default function StudentDashboard({
  student,
  onSelectSubject,
  onNavigateToTab,
  onOpenAvatarModal,
  onUpdateChapterRemark,
  onDeleteNote,
  isAdmin = false,
  onRefresh,
  isRefreshing = false
}: StudentDashboardProps) {
  const [allClassNotes, setAllClassNotes] = useState<ClassNote[]>(() => getLocalClassNotes());
  const [testBankVersion, setTestBankVersion] = useState(0);

  useEffect(() => {
    return subscribeToClassNotes((notes) => {
      if (!Array.isArray(notes)) return;
      setAllClassNotes((prev) => (areClassNotesEqual(prev, notes) ? prev : notes));
    });
  }, []);

  useEffect(() => {
    fetchAllPracticeTestsFromSupabase();
    if (student?.id) {
      fetchStudentTestAttemptsFromSupabase(student.id, student.name);
    }

    const handleUpdate = () => {
      setTestBankVersion((v) => v + 1);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("practice-tests-updated", handleUpdate);
      window.addEventListener("test-attempts-updated", handleUpdate);
      window.addEventListener("notes-progress-updated", handleUpdate);
      window.addEventListener("storage", handleUpdate);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("practice-tests-updated", handleUpdate);
        window.removeEventListener("test-attempts-updated", handleUpdate);
        window.removeEventListener("notes-progress-updated", handleUpdate);
        window.removeEventListener("storage", handleUpdate);
      }
    };
  }, [student?.id, student?.name]);

  const [showAttendanceHistoryModal, setShowAttendanceHistoryModal] = useState(false);
  const [showFeeHistoryModal, setShowFeeHistoryModal] = useState(false);
  const [showStudentDetailsModal, setShowStudentDetailsModal] = useState(false);
  const [showAnnouncementsModal, setShowAnnouncementsModal] = useState(false);
  const [lastSeenAnnouncementId, setLastSeenAnnouncementId] = useState<string>(() => {
    return localStorage.getItem("last_seen_announcement_id") || "";
  });
  const [weeklyAttendance, setWeeklyAttendance] = useState<Array<{ label: string; key: string; status: "present" | "absent" | "holiday" | "hidden" | "na" }>>([]);
  const [attendanceModalMonthIndex, setAttendanceModalMonthIndex] = useState(0);

  const [announcements, setAnnouncements] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem("tuition_announcements");
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const hasNewAnnouncements = useMemo(() => {
    if (announcements.length === 0) return false;
    return announcements[0].id !== lastSeenAnnouncementId;
  }, [announcements, lastSeenAnnouncementId]);

  const handleCloseAnnouncementsModal = () => {
    setShowAnnouncementsModal(false);
    if (announcements.length > 0) {
      const latestId = announcements[0].id;
      setLastSeenAnnouncementId(latestId);
      safeLocalStorageSetItem("last_seen_announcement_id", latestId);
    }
  };

  useEffect(() => {
    const unsub = subscribeToAnnouncements((list) => {
      setAnnouncements(list);
    });
    return () => {
      unsub();
    };
  }, []);

  const studentMonthsSinceJoining = useMemo(() => {
    const regDate = student.registrationDate || "2026-06-01";
    const [regYearStr, regMonthStr] = regDate.split("-");
    const regYear = parseInt(regYearStr) || 2026;
    const regMonthIdx = (parseInt(regMonthStr) || 6) - 1; // 0-indexed

    // Prevent displaying any future months in student portal
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthIdx = today.getMonth();

    return ALL_ACADEMIC_MONTHS.filter((m) => {
      const [mName, yStr] = m.split(" ");
      const mIdx = MONTH_NAMES.indexOf(mName);
      const year = parseInt(yStr) || 2026;
      
      const isAfterReg = year > regYear || (year === regYear && mIdx >= regMonthIdx);
      const isBeforeOrCurrent = year < currentYear || (year === currentYear && mIdx <= currentMonthIdx);

      return isAfterReg && isBeforeOrCurrent;
    });
  }, [student.registrationDate]);

  const attendanceHistoryByMonth = useMemo(() => {
    const records: Record<string, { present: number; absent: number; total: number }> = {};
    studentMonthsSinceJoining.forEach((m) => {
      records[m] = { present: 0, absent: 0, total: 0 };
    });

    Object.entries(student.attendance).forEach(([dateStr, status]) => {
      if (status === "na") return;
      try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;
        const key = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
        if (records[key]) {
          records[key].total += 1;
          if (status === true) records[key].present += 1;
          else if (status === false) records[key].absent += 1;
        }
      } catch (e) {
        console.error(e);
      }
    });

    return studentMonthsSinceJoining.map((m) => {
      const stats = records[m] || { present: 0, absent: 0, total: 0 };
      const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 100;
      return { month: m, ...stats, pct };
    });
  }, [student.attendance, studentMonthsSinceJoining, MONTH_NAMES]);

  const feeHistory = useMemo(() => {
    return studentMonthsSinceJoining.map((m) => {
      const status = getEvaluatedFeeStatus(student, m).toLowerCase();
      const payDate = student.feePaymentDates?.[m];
      const paymentMode = (student as Student & { feePaymentModes?: Record<string, string> }).feePaymentModes?.[m];
      return { month: m, status, payDate, paymentMode };
    });
  }, [student, studentMonthsSinceJoining]);

  const attendanceStats = useMemo(() => {
    const records = Object.values(student.attendance || {}).filter((r) => r !== "na");
    const total = records.length;
    const presents = records.filter((r) => r === true).length;
    const rate = total > 0 ? Math.round((presents / total) * 100) : 100;
    return { presents, total, rate };
  }, [student.attendance]);

  const studentSubjects = useMemo(() => {
    return getStudentSubjects(student, allClassNotes);
  }, [student, allClassNotes]);

  const subjectProgress = useMemo(() => {
    const allStudentAttempts = getAllTestAttempts();
    return studentSubjects
      .map((sub) => {
        const weighted = calculateSubjectWeightedProgress(sub, student, allClassNotes, allStudentAttempts, isAdmin);
        return {
          name: sub,
          total: weighted.total,
          completed: weighted.completed,
          rate: weighted.rate,
          notes: weighted.notes,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [studentSubjects, student, allClassNotes, isAdmin, testBankVersion]);

  const recentAttendance = useMemo(() => {
    const dates = ["2026-07-14", "2026-07-13", "2026-07-12", "2026-07-11", "2026-07-10", "2026-07-09", "2026-07-08"];
    return dates.map((date) => {
      const dateObj = new Date(date);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return { date, dayName: dayNames[dateObj.getDay()], dayNum: dateObj.getDate(), val: student.attendance?.[date] };
    });
  }, [student.attendance]);

  const currentMonthName = useMemo(() => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const d = new Date();
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  }, []);

  const todayKey = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const attendanceTodayStatus = student.attendance?.[todayKey];
  const attendanceTodayLabel = attendanceTodayStatus === true ? "Present" : attendanceTodayStatus === false ? "Absent" : "Not marked";
  const attendanceTodayBadge = attendanceTodayStatus === true
    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : attendanceTodayStatus === false
      ? "border-rose-400/40 bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300";

  const attendanceStreak = useMemo(() => {
    const dates = Object.keys(student.attendance || {})
      .filter((date) => date <= todayKey)
      .sort((a, b) => b.localeCompare(a));

    let streak = 0;
    for (const date of dates) {
      const status = student.attendance?.[date];
      if (status === true) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  }, [student.attendance, todayKey]);

  const lastAttendanceDate = useMemo(() => {
    const dates = Object.keys(student.attendance || {})
      .filter((date) => student.attendance?.[date] === true || student.attendance?.[date] === false)
      .sort((a, b) => b.localeCompare(a));
    return dates[0] || null;
  }, [student.attendance]);

  const currentMonthAttendanceCount = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    return Object.keys(student.attendance || {}).filter((date) => date.startsWith(monthKey) && student.attendance?.[date] !== "na").length;
  }, [student.attendance]);

  const currentMonthStatus = getEvaluatedFeeStatus(student, currentMonthName).toLowerCase();

  useEffect(() => {
    setWeeklyAttendance(getWeeklyAttendanceDays(student));
    fetchAllPracticeTestsFromSupabase();

    const handleUpdate = () => {
      // Trigger re-render when practice tests or attempts are updated
      setAllClassNotes([...getLocalClassNotes()]);
      setTestBankVersion((v) => v + 1);
    };
    window.addEventListener("practice-tests-updated", handleUpdate);
    window.addEventListener("test-attempts-updated", handleUpdate);
    return () => {
      window.removeEventListener("practice-tests-updated", handleUpdate);
      window.removeEventListener("test-attempts-updated", handleUpdate);
    };
  }, [student]);

  const feeStats = useMemo(() => {
    const ledger = getEvaluatedStudentLedger(student);
    const entries = Object.values(ledger);
    const paidCount = entries.filter((status) => status === "PAID").length;
    const unpaidCount = entries.filter((status) => status === "UNPAID").length;
    return { paidCount, unpaidCount };
  }, [student]);

  const pendingMonths = useMemo(() => {
    return getPendingFeeMonths(student);
  }, [student]);

  const totalPendingAmount = useMemo(() => {
    return calculateStudentOutstandingAmount(student);
  }, [student]);

  const lastPaymentDate = useMemo(() => {
    const entries = Object.entries(student.feePaymentDates || {})
      .filter(([, value]) => Boolean(value))
      .sort((a, b) => (b[1] || "").localeCompare(a[1] || ""));
    return entries[0]?.[1] || null;
  }, [student.feePaymentDates]);

  const selectedAttendanceMonth = studentMonthsSinceJoining[attendanceModalMonthIndex] || studentMonthsSinceJoining[0] || "";
  const canGoPreviousAttendanceMonth = attendanceModalMonthIndex > 0;
  const canGoNextAttendanceMonth = attendanceModalMonthIndex < studentMonthsSinceJoining.length - 1;

  useEffect(() => {
    if (studentMonthsSinceJoining.length > 0) {
      setAttendanceModalMonthIndex(studentMonthsSinceJoining.length - 1);
    } else {
      setAttendanceModalMonthIndex(0);
    }
  }, [student.registrationDate, student.id, studentMonthsSinceJoining.length]);

  const nextDueLabel = pendingMonths[0] || "No pending dues";
  const paidAcademicYearAmount = feeStats.paidCount * (student.monthlyFee || 0);
  const currentServiceStatus = (student.serviceStatus || student.service_status || "active").toLowerCase();

  return (
    <div className="flex flex-col gap-3 overflow-x-hidden pb-6 animate-fadeIn" id="student-dashboard-root">
      {currentServiceStatus === "paused" && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-300 shadow-xs" id="service-status-paused-banner">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs sm:text-sm font-bold leading-relaxed">
            Your learning services are temporarily paused. Please contact the academy for assistance.
          </p>
        </div>
      )}
      {currentServiceStatus === "ended" && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center gap-3 text-rose-800 dark:text-rose-300 shadow-xs" id="service-status-ended-banner">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="text-xs sm:text-sm font-bold leading-relaxed">
            Your academy services have ended. Please contact the administrator if you believe this is an error.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-600 dark:text-blue-400">Personal Student Space</p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh Dashboard"
            aria-label="Refresh Dashboard"
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/40 dark:hover:text-blue-400 flex items-center justify-center transition-all border border-slate-200 dark:border-slate-700 shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-blue-600 dark:text-blue-400" : ""}`} />
          </button>
        )}
      </div>

      <HeroCard 
        student={student} 
        onOpenAvatarModal={onOpenAvatarModal} 
        onOpenStudentDetails={() => setShowStudentDetailsModal(true)} 
        formatDate={formatDate} 
        onOpenAnnouncements={() => {
          if (currentServiceStatus === "ended") {
            alert("Your academy services have ended. Please contact the administrator if you believe this is an error.");
            return;
          }
          setShowAnnouncementsModal(true);
        }} 
        hasAnnouncements={hasNewAnnouncements} 
      />

      <div className="grid grid-cols-2 gap-2 sm:gap-4" id="fixed-student-tiles">
        <div className="min-w-0 h-full">
          <AttendanceCard
            attendanceStats={attendanceStats}
            attendanceTodayBadge={attendanceTodayBadge}
            attendanceTodayLabel={attendanceTodayLabel}
            weeklyAttendance={weeklyAttendance}
            attendanceStreak={attendanceStreak}
            currentMonthAttendanceCount={currentMonthAttendanceCount}
            lastAttendanceDate={lastAttendanceDate}
            formatDate={formatDate}
            onOpenSheet={() => {
              if (studentMonthsSinceJoining.length > 0) {
                setAttendanceModalMonthIndex(studentMonthsSinceJoining.length - 1);
              }
              setShowAttendanceHistoryModal(true);
            }}
          />
        </div>
        <div className="min-w-0 h-full">
          <FeeCard
            student={student}
            currentMonthName={currentMonthName}
            currentMonthStatus={currentMonthStatus}
            pendingMonths={pendingMonths}
            totalPendingAmount={totalPendingAmount}
            paidAcademicYearAmount={paidAcademicYearAmount}
            lastPaymentDate={lastPaymentDate}
            onOpenSheet={() => setShowFeeHistoryModal(true)}
          />
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {subjectProgress.length === 0 ? (
          <div className="col-span-full py-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-6 shadow-xs">
            <BookOpen className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-2 stroke-[1.2]" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No Enrolled Subjects</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">You do not have any enrolled subjects assigned yet.</p>
          </div>
        ) : (
          subjectProgress.map((sub, index) => (
            <SubjectProgressCard
              key={sub.name}
              subject={sub}
              index={index}
              onSelectSubject={onSelectSubject}
              student={student}
            />
          ))
        )}
      </div>

      <AttendanceBottomSheet
        isOpen={showAttendanceHistoryModal}
        onClose={() => setShowAttendanceHistoryModal(false)}
        attendanceStats={attendanceStats}
        attendanceHistoryByMonth={attendanceHistoryByMonth}
        student={student}
        selectedMonthLabel={selectedAttendanceMonth}
        onPreviousMonth={() => setAttendanceModalMonthIndex((prev) => Math.max(0, prev - 1))}
        onNextMonth={() => setAttendanceModalMonthIndex((prev) => Math.min(studentMonthsSinceJoining.length - 1, prev + 1))}
        canGoPrevious={canGoPreviousAttendanceMonth}
        canGoNext={canGoNextAttendanceMonth}
      />

      <FeeHistoryBottomSheet
        isOpen={showFeeHistoryModal}
        onClose={() => setShowFeeHistoryModal(false)}
        feeHistory={feeHistory}
        student={student}
        formatDate={formatDate}
      />

      <StudentDetailsModal
        isOpen={showStudentDetailsModal}
        onClose={() => setShowStudentDetailsModal(false)}
        student={student}
        formatDate={formatDate}
      />

      {/* Announcements Modal */}
      {showAnnouncementsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-slate-950/70 backdrop-blur-sm animate-fadeIn" onClick={handleCloseAnnouncementsModal}>
          <div className="w-full max-w-md rounded-[30px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3.5 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500">
                  <Bell className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-slate-100">Announcements</h3>
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Latest updates</p>
                </div>
              </div>
              <button onClick={handleCloseAnnouncementsModal} className="rounded-full bg-slate-100 dark:bg-slate-800 p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
              {announcements.length === 0 ? (
                <div className="text-center py-8">
                  <Bell className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto mb-2 stroke-[1.2]" />
                  <p className="text-xs text-slate-400 italic">No announcements posted yet.</p>
                </div>
              ) : (
                announcements.map((ann, idx) => (
                  <div 
                    key={ann.id} 
                    className={`p-4 rounded-2xl border ${
                      idx === 0 
                        ? "border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/25 dark:bg-indigo-950/10" 
                        : "border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {idx === 0 && (
                        <span className="flex h-2 w-2 rounded-full bg-indigo-500 mt-1.5 shrink-0 animate-pulse" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold leading-relaxed text-slate-800 dark:text-slate-200">
                          {ann.text}
                        </p>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-2 block tracking-wider">
                          Posted on: {ann.date}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-3 flex justify-end">
              <button
                onClick={handleCloseAnnouncementsModal}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
