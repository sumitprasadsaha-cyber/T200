import React, { useState, useMemo, useEffect } from "react";
import StudentAvatar from "./StudentAvatar";
import { getInstitutionName, saveStudentDoc, subscribeToClassNotes, getLocalClassNotes } from "../lib/firestoreService";
import { uploadReportToStorage } from "../lib/storageService";
import { saveAndOpenGeneratedPdf } from "../lib/nativePdfService";
import { 
  ArrowLeft, 
  Phone, 
  CreditCard, 
  User, 
  GraduationCap, 
  BookOpen, 
  ChevronRight,
  Calendar,
  Check,
  X,
  Camera,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  Award,
  TrendingUp,
  FileText,
  Save,
  Plus,
  Mail,
  Eye,
  EyeOff,
  Trash2
} from "lucide-react";
import { jsPDF } from "jspdf";
import { Student, ClassNote } from "../types";
import { getUnpaidOverdueMonths, MONTH_NAMES, isFutureMonth, hasAttendedInMonth } from "./StudentList";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { getMonthsUpToCurrent, ALL_ACADEMIC_MONTHS } from "../utils/monthHelper";
import { getChapterProgressRecord, getStatusConfig, calculateSubjectProgress } from "../utils/chapterProgressHelper";
import {
  getEvaluatedFeeStatus,
  getPendingFeeMonths,
  calculateStudentOutstandingAmount,
  generateWhatsAppBillingMessage
} from "../utils/feeBillingHelper";

interface StudentDetailsProps {
  student: Student;
  qrCode: string | null;
  onBack: () => void;
  onSelectSubject: (subject: string) => void;
  onToggleAttendance: (date: string, isPresent: boolean | "na") => void;
  onToggleFeePayment: () => void; 
  onSetFeeStatus: (monthYear: string, status: "paid" | "unpaid" | "na", paymentDate?: string) => void;
  onAddFeeMonth?: (monthYear: string) => void;
  onOpenAvatarModal: () => void;
  onAddNote: (subject: string, chapterNo: number, chapterName: string, pdfUrl: string, pdfFileName: string, isCompleted?: boolean, remark?: string) => void;
  onToggleChapterCompletion: (subject: string, noteId: string) => void;
  onDeleteNote?: (subject: string, noteId: string) => void;
  onUpdateChapterRemark: (subject: string, noteId: string, remark: string) => void;
  onUpdateEnrolledSubjects?: (subjects: string[]) => void;
  isAdmin?: boolean;
}

// Check if a specific month is overdue (deadline is 3rd of next month at 1:00 PM)
function isMonthOverdue(monthYearStr: string, currentDateTime: Date = new Date("2026-07-14T14:43:00")): boolean {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [monthName, yearStr] = monthYearStr.split(" ");
  const monthIndex = monthNames.indexOf(monthName);
  const year = parseInt(yearStr);
  
  if (monthIndex === -1 || isNaN(year)) return false;
  
  let nextMonthIdx = monthIndex + 1;
  let nextMonthYear = year;
  if (nextMonthIdx > 11) {
    nextMonthIdx = 0;
    nextMonthYear += 1;
  }
  
  // Overdue if unpaid after the 3rd day of the next month at 1:00 PM
  const deadline = new Date(nextMonthYear, nextMonthIdx, 3, 13, 0, 0);
  return currentDateTime > deadline;
}

// Helper to format registration date
function formatRegDate(dateStr?: string): string {
  if (!dateStr) return "14 July 2026";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}

// Fixed standard chapter templates per subject
const DEFAULT_CHAPTER_TEMPLATES: Record<string, string[]> = {
  "English": ["Reading Comprehension & Passages", "Tenses & Auxiliary Verbs", "Formal Letters & Essays", "The Last Lesson & Prose", "My Mother at Sixty-Six (Poem)"],
  "Hindi": ["अपठित गद्यांश एवं बोध", "व्याकरण, वर्ण एवं संधि", "निबंध एवं पत्र लेखन", "कबीर की साखियाँ", "सूरदास के पद एवं व्याख्या"],
  "Nepali": ["अपठित गद्यांश र बोध", "शब्दवर्ग र व्याकरण अभ्यास", "चिठी र रचनात्मक निबन्ध", "सङ्गति र कविता व्याख्या", "नेपाली कथा र साहित्य परिचय"],
  "Mathematics": ["Real Numbers & Euclid Division", "Polynomials & Algebraic Identites", "Quadratic Equations & Roots", "Arithmetic Progressions Series", "Trigonometry Ratios & Heights"],
  "Science": ["Chemical Reactions & Balance", "Acids, Bases & pH Salts", "Life Processes & Circulation", "Control & Coordination Systems", "Light Reflection & Lenses"],
  "Computer Science": ["Python Programming Basics", "Functions, Modules & Scope", "File Handling (Text/CSV/Binary)", "Database Concepts & SQL Commands", "Computer Networks & Topologies"],
  "Social Science": ["The Rise of Nationalism in Europe", "Nationalism in India", "Resources, Soil & Development", "Federalism & Decentralization", "Sectors of Indian Economy"],
  "Physics": ["Electric Charge & Fields", "Electrostatic Potential", "Current Electricity", "Moving Charges & Magnetism", "Electromagnetic Induction"],
  "Chemistry": ["The Solid State & Crystals", "Solutions & Osmotic Pressure", "Electrochemistry & Nernst", "Chemical Kinetics & Rates", "Surface Chemistry & Catalysis"],
  "Biology": ["Reproduction in Organisms", "Sexual Reproduction in Plants", "Human Reproduction & Health", "Principles of Inheritance", "Molecular Basis of Inheritance"]
};

const getSyllabusChaptersForSubject = (subject: string): { chapterNo: number; name: string }[] => {
  const list = DEFAULT_CHAPTER_TEMPLATES[subject] || [
    "Introduction & Structural Core",
    "Foundational Conceptual Models",
    "Practical Exercise Solutions",
    "Advanced Application Methods",
    "Comprehensive Revision Guide"
  ];
  return list.map((name, index) => ({
    chapterNo: index + 1,
    name
  }));
};

export default function StudentDetails({
  student,
  qrCode,
  onBack,
  onSelectSubject,
  onToggleAttendance,
  onToggleFeePayment,
  onSetFeeStatus,
  onAddFeeMonth,
  onOpenAvatarModal,
  onAddNote,
  onToggleChapterCompletion,
  onDeleteNote,
  onUpdateChapterRemark,
  onUpdateEnrolledSubjects,
  isAdmin = true
}: StudentDetailsProps) {
  const [activeTab, setActiveTab] = useState<"Profile" | "Progress" | "Attendance" | "Subjects" | "Fee">("Profile");
  const [institutionName, setInstitutionName] = useState("Sumit Tuition App");
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [isEditingSubjects, setIsEditingSubjects] = useState(false);
  const [tempSubjects, setTempSubjects] = useState<string[]>([]);
  const [newSubjectInput, setNewSubjectInput] = useState("");
  const [pastAttendanceDate, setPastAttendanceDate] = useState(new Date().toISOString().split("T")[0]);
  const [attendanceMonth, setAttendanceMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`; // e.g. "2026-07"
  });
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [showAllDetailsModal, setShowAllDetailsModal] = useState(false);
  const [showPassInDetailsModal, setShowPassInDetailsModal] = useState(false);

  // Delete Chapter Note modal state
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<{ subject: string; noteId: string } | null>(null);
  const [isDeletingNote, setIsDeletingNote] = useState(false);

  const [allClassNotes, setAllClassNotes] = useState<ClassNote[]>(() => getLocalClassNotes());
  useEffect(() => {
    return subscribeToClassNotes((notes) => setAllClassNotes(notes));
  }, []);

  useEffect(() => {
    let active = true;
    const loadInstitutionName = async () => {
      const name = await getInstitutionName();
      if (active) setInstitutionName(name);
    };

    loadInstitutionName();
    const handleInstitutionNameUpdate = () => {
      void loadInstitutionName();
    };

    window.addEventListener("institution-name-updated", handleInstitutionNameUpdate);
    return () => {
      active = false;
      window.removeEventListener("institution-name-updated", handleInstitutionNameUpdate);
    };
  }, []);

  // Horizontal Swipe Gestures
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (touchStart === null || touchEnd === null) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    const tabs = isAdmin
      ? ["Profile", "Fee"]
      : ["Profile", "Progress", "Attendance", "Subjects", "Fee"];
    const currentIdx = tabs.indexOf(activeTab as any);

    if (isLeftSwipe && currentIdx < tabs.length - 1 && currentIdx !== -1) {
      setActiveTab(tabs[currentIdx + 1] as any);
    } else if (isRightSwipe && currentIdx > 0) {
      setActiveTab(tabs[currentIdx - 1] as any);
    }
  };
  
  // Selected progress subject (default is the first enrolled subject)
  const [selectedProgressSubject, setSelectedProgressSubject] = useState<string>(() => {
    return student.enrolledSubjects[0] || "";
  });

  // State for remark input focus
  const [editingRemarkNoteId, setEditingRemarkNoteId] = useState<string | null>(null);
  const [editingRemarkText, setEditingRemarkText] = useState<string>("");

  // Academic Report Modal State
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

  // WhatsApp billing popup overlay state
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedQrImage, setCopiedQrImage] = useState(false);

  const visibleMonths = useMemo(() => {
    return student.feeMonthsList && student.feeMonthsList.length > 0
      ? student.feeMonthsList
      : getMonthsUpToCurrent();
  }, [student.feeMonthsList]);

  const handleAddNextMonthClick = () => {
    if (!onAddFeeMonth) return;
    const lastMonth = visibleMonths[visibleMonths.length - 1];
    const lastIdx = ALL_ACADEMIC_MONTHS.indexOf(lastMonth);
    if (lastIdx > -1 && lastIdx < ALL_ACADEMIC_MONTHS.length - 1) {
      const nextMonth = ALL_ACADEMIC_MONTHS[lastIdx + 1];
      onAddFeeMonth(nextMonth);
    }
  };

  const studentFeeMonths = useMemo(() => {
    return student.feeMonths || {};
  }, [student.feeMonths]);

  // List of overdue unpaid months
  const overdueUnpaidMonths = useMemo(() => {
    return getPendingFeeMonths(student);
  }, [student]);

  // Total pending amount
  const totalPendingAmount = useMemo(() => {
    return calculateStudentOutstandingAmount(student);
  }, [student]);

  // Formatted months list for reminder message, e.g. "June, July"
  const formattedUnpaidMonthsText = useMemo(() => {
    return overdueUnpaidMonths.map(m => m.split(" ")[0]).join(", ");
  }, [overdueUnpaidMonths]);

  // Grammatically corrected billing message matching exact WhatsApp instruction template
  const whatsappMessage = useMemo(() => {
    return generateWhatsAppBillingMessage(student);
  }, [student]);

  const initials = useMemo(() => {
    if (!student.name) return "?";
    const parts = student.name.split(" ");
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return student.name[0].toUpperCase();
  }, [student.name]);

  // Helper to generate selectable attendance months from joining date to current month
  const availableAttendanceMonths = useMemo(() => {
    const regDate = student.registrationDate || "2026-06-01";
    const [regYearStr, regMonthStr] = regDate.split("-");
    const regYear = parseInt(regYearStr) || 2026;
    const regMonthIdx = (parseInt(regMonthStr) || 6) - 1; // 0-indexed

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthIdx = today.getMonth();

    const months = [];
    const curr = new Date(regYear, regMonthIdx, 1);
    const end = new Date(currentYear, currentMonthIdx, 1);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    while (curr <= end) {
      const yyyy = curr.getFullYear();
      const mm = String(curr.getMonth() + 1).padStart(2, "0");
      months.push({
        value: `${yyyy}-${mm}`,
        label: `${monthNames[curr.getMonth()]} ${yyyy}`
      });
      curr.setMonth(curr.getMonth() + 1);
    }
    return months.reverse(); // Newest first
  }, [student.registrationDate]);

  // Generate all days of the currently selected attendance month
  const currentMonthDates = useMemo(() => {
    if (!attendanceMonth) return [];
    const [yearStr, monthStr] = attendanceMonth.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr) - 1; // 0-indexed
    
    const dates = [];
    const lastDay = new Date(year, month + 1, 0).getDate();
    
    // Reverse order to show newest dates of the month first
    for (let day = lastDay; day >= 1; day--) {
      const d = new Date(year, month, day);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    return dates;
  }, [attendanceMonth]);

  // Attendance history formatting for the selected month
  const attendanceHistory = useMemo(() => {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const regDateStr = student.registrationDate || "2026-06-01";
    const todayStr = new Date().toISOString().split("T")[0];

    const sortedDates = [...currentMonthDates].sort((a, b) => b.localeCompare(a));
    const today = new Date().toISOString().split("T")[0];
    const [todayYear, todayMonth] = today.split("-");
    const [selectedYear, selectedMonth] = attendanceMonth.split("-");
    const isCurrentMonth = todayYear === selectedYear && todayMonth === selectedMonth;

    const orderedDates = isCurrentMonth && sortedDates.includes(today)
      ? [today, ...sortedDates.filter((date) => date !== today)]
      : sortedDates;

    return orderedDates.map((date) => {
      const dateObj = new Date(date);
      const monthName = monthNames[dateObj.getMonth()];
      const dayNum = dateObj.getDate();
      const dayOfWeekName = dayNames[dateObj.getDay()];
      
      const attendanceVal = student.attendance[date];
      const isPresent = attendanceVal === true;
      const isAbsent = attendanceVal === false;
      const isNA = attendanceVal === "na";
      const isMarked = attendanceVal !== undefined;

      const isBeforeJoining = date < regDateStr;
      const isFutureDate = date > todayStr;

      return { 
        date, 
        dayName: dayOfWeekName, 
        monthName, 
        dayNum, 
        isPresent, 
        isAbsent, 
        isNA, 
        isMarked,
        isBeforeJoining,
        isFutureDate
      };
    });
  }, [currentMonthDates, student.attendance, student.registrationDate]);

  // Empty placeholder list for compatibility
  const pastAttendanceLogs = useMemo(() => {
    return [];
  }, []);

  const attendanceStats = useMemo(() => {
    const records = Object.values(student.attendance).filter(r => r !== "na");
    const total = records.length;
    const presents = records.filter(r => r === true).length;
    const rate = total > 0 ? Math.round((presents / total) * 100) : 0;
    return { total, presents, rate };
  }, [student.attendance]);

  // Alphabetically sorted enrolled subjects
  const sortedEnrolledSubjects = useMemo(() => {
    return [...student.enrolledSubjects].sort((a, b) => a.localeCompare(b));
  }, [student.enrolledSubjects]);

  // Calculate detailed chapters list derived from central classNotes, student.notes & chapterProgress
  const activeChaptersList = useMemo(() => {
    const subject = selectedProgressSubject;
    if (!subject) return [];

    const summary = calculateSubjectProgress(subject, student, allClassNotes, isAdmin);
    return summary.chapters.map((c) => ({
      chapterNo: c.chapterNo,
      chapterName: c.chapterName,
      isReal: true,
      id: c.notes[0]?.id || `ch-${c.chapterNo}`,
      isCompleted: c.isCompleted,
      remark: c.remark,
      pdfFileName: c.notes.map((n) => n.pdfFileName).filter(Boolean).join(", ")
    })).sort((a, b) => (a.chapterNo || 0) - (b.chapterNo || 0));
  }, [selectedProgressSubject, student, allClassNotes, isAdmin]);

  // Subject-specific and collective progress indicators
  const subjectCompletionStats = useMemo(() => {
    const total = activeChaptersList.length;
    const completed = activeChaptersList.filter(ch => ch.isCompleted).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percent };
  }, [activeChaptersList]);

  // Collective Academic Standing & Progress Percentage calculated from chapters (excluding parts)
  const collectiveProgressStats = useMemo(() => {
    let grandTotal = 0;
    let grandCompleted = 0;
    const subjectBreakdown: Record<string, { total: number; completed: number; percent: number; remark: string }> = {};

    sortedEnrolledSubjects.forEach(subject => {
      const summary = calculateSubjectProgress(subject, student, allClassNotes, isAdmin);
      grandTotal += summary.total;
      grandCompleted += summary.completed;

      const topRemark = summary.chapters.find((c) => c.remark)?.remark || "";

      subjectBreakdown[subject] = {
        total: summary.total,
        completed: summary.completed,
        percent: summary.rate,
        remark: topRemark || "On track with syllabus review."
      };
    });

    const overallPercent = grandTotal > 0 ? Math.round((grandCompleted / grandTotal) * 100) : 0;
    let standing = "On Track";
    if (grandTotal === 0) standing = "New Student";
    else if (overallPercent >= 85) standing = "Excellent";
    else if (overallPercent < 45) standing = "Needs Focus";

    return {
      grandTotal,
      grandCompleted,
      overallPercent,
      standing,
      breakdown: subjectBreakdown
    };
  }, [student.notes, student.chapterProgress, sortedEnrolledSubjects]);

  // Generate complete Academic Performance WhatsApp Report
  const formattedAcademicReport = useMemo(() => {
    const dateStr = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    let text = `*INGENIOUS STUDY CIRCLE*\n*ACADEMIC PERFORMANCE REPORT*\n\n`;
    text += `Student Name: *${student.name}*\n`;
    text += `Class/Grade: *${student.classGrade}*\n`;
    text += `Date: ${dateStr}\n\n`;
    text += `*Overall Progress: ${collectiveProgressStats.overallPercent}% Completed*\n`;
    text += `Total Completed Chapters: ${collectiveProgressStats.grandCompleted} / ${collectiveProgressStats.grandTotal}\n`;
    text += `Academic Standing: *${collectiveProgressStats.standing}*\n\n`;
    text += `*Subject Syllabus Breakdown:*\n`;

    (Object.entries(collectiveProgressStats.breakdown) as [string, { total: number; completed: number; percent: number; remark: string }][]).forEach(([subj, data]) => {
      text += `- *${subj}*: ${data.percent}% Completed (${data.completed}/${data.total} Chapters)\n`;
      text += `  _Tutor Remarks:_ ${data.remark}\n`;
    });

    text += `\n_${institutionName} - Shaping Bright Minds._`;
    return text;
  }, [student, collectiveProgressStats]);

  const handleCopyText = () => {
    navigator.clipboard.writeText(whatsappMessage);
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const handleCopyReportText = () => {
    navigator.clipboard.writeText(formattedAcademicReport);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const cleanPhoneNumber = (ph: string) => {
    return ph.replace(/[^0-9+]/g, "");
  };

  const handleTriggerWhatsApp = (phone: string, msgText: string) => {
    const targetPh = cleanPhoneNumber(phone);
    const link = `https://api.whatsapp.com/send?phone=${targetPh}&text=${encodeURIComponent(msgText)}`;
    window.open(link, "_blank");
  };

  const handleGeneratePdfReport = async () => {
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    
    // Draw Header border or styling
    doc.setFillColor(30, 58, 138); // Deep Navy blue accent
    doc.rect(0, 0, 210, 16, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.text("INGENIOUS STUDY CIRCLE - ACADEMIC PROGRESS REPORT", 12, 10);
    
    // Document Title
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(22);
    doc.setFont("Helvetica", "bold");
    doc.text("STUDENT PERFORMANCE LEDGER", 12, 34);
    
    // Horizontal divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(12, 38, 198, 38);
    
    // Student Metadata
    doc.setFontSize(10);
    doc.setFont("Helvetica", "bold");
    doc.text("Student Name:", 12, 46);
    doc.setFont("Helvetica", "normal");
    doc.text(student.name, 48, 46);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Class / Grade:", 12, 52);
    doc.setFont("Helvetica", "normal");
    doc.text(student.classGrade, 48, 52);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Registration:", 12, 58);
    doc.setFont("Helvetica", "normal");
    doc.text(formatRegDate(student.registrationDate), 48, 58);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Report Date:", 110, 46);
    doc.setFont("Helvetica", "normal");
    doc.text(dateStr, 148, 46);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Syllabus Review:", 110, 52);
    doc.setFont("Helvetica", "normal");
    doc.text(`${collectiveProgressStats.overallPercent}% Completed`, 148, 52);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Standing Category:", 110, 58);
    doc.setFont("Helvetica", "normal");
    doc.text(collectiveProgressStats.standing, 148, 58);
    
    // Another divider
    doc.line(12, 64, 198, 64);
    
    // Subjects Progress Table/Layout
    let currentY = 74;
    
    sortedEnrolledSubjects.forEach((subject) => {
      // Check for page overflow
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }
      
      // Subject Header Box
      doc.setFillColor(243, 244, 246);
      doc.rect(12, currentY, 186, 9, "F");
      
      doc.setTextColor(30, 41, 59);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.text(`${subject.toUpperCase()} SYLLABUS SYNOPSIS`, 16, currentY + 6);
      
      const percent = collectiveProgressStats.breakdown[subject]?.percent || 0;
      doc.text(`${percent}% Done`, 168, currentY + 6);
      
      currentY += 14;
      
      const summary = calculateSubjectProgress(subject, student, allClassNotes, isAdmin);
      let chaptersToPrint = summary.chapters.map((c) => ({
        chapterNo: c.chapterNo,
        chapterName: c.chapterName,
        statusLabel: c.statusLabel,
        isCompleted: c.isCompleted,
        remark: c.remark
      }));

      if (chaptersToPrint.length === 0) {
        const defaultTemplates = DEFAULT_CHAPTER_TEMPLATES[subject] || [
          "Introduction & Structural Core",
          "Foundational Conceptual Models",
          "Practical Exercise Solutions",
          "Advanced Application Methods",
          "Comprehensive Revision Guide"
        ];
        chaptersToPrint = defaultTemplates.map((name, idx) => ({
          chapterNo: idx + 1,
          chapterName: name,
          statusLabel: "Pending",
          isCompleted: false,
          remark: ""
        }));
      }

      chaptersToPrint.forEach((ch) => {
        if (currentY > 270) {
          doc.addPage();
          currentY = 20;
        }
        
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        doc.text(`Ch ${ch.chapterNo}: ${ch.chapterName}`, 15, currentY);
        
        // Completion tag
        if (ch.isCompleted) {
          doc.setTextColor(16, 185, 129);
          doc.text("Completed", 168, currentY);
        } else {
          doc.setTextColor(217, 119, 6);
          doc.text("Pending", 168, currentY);
        }
        
        // Print Remarks if present
        if (ch.remark) {
          currentY += 4.5;
          doc.setFont("Helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(`  Tutor Remarks: "${ch.remark}"`, 15, currentY);
        }
        
        currentY += 7.5;
      });
      
      currentY += 5; // spacing between subjects
    });
    
    // Add professional footer on current page
    if (currentY > 265) {
      doc.addPage();
      currentY = 30;
    }
    
    doc.setDrawColor(226, 232, 240);
    doc.line(12, 276, 198, 276);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${institutionName} - Shaping Bright Minds`, 12, 282);
    doc.text("This progress card is digitally authorized by the Administrator.", 115, 282);
    
    // Save report with robust native & browser fallback
    const fileName = `${student.name.replace(/\s+/g, "_")}_Progress_Report.pdf`;
    try {
      const pdfBlob = doc.output("blob");
      await saveAndOpenGeneratedPdf(pdfBlob, fileName);
    } catch (error) {
      console.warn("[PDF Generator] Native save failed, using fallback:", error);
      try {
        doc.save(fileName);
      } catch (e) {
        console.error("[PDF Generator] Fallback failed:", e);
        const string = doc.output("datauristring");
        window.open(string, "_blank");
      }
    }

    // Automatically upload the generated report to Supabase Storage and store metadata in Firestore
    try {
      const blob = doc.output("blob");
      console.log(`[StudentDetails] Uploading generated progress report to Supabase Storage: ${fileName}`);
      
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
            uploadedBy: "Admin",
            downloadUrl: metadata.downloadUrl,
          };

          const updatedStudent = {
            ...student,
            reports: [...(student.reports || []), newReport],
          };

          await saveStudentDoc(updatedStudent);
          console.log("[StudentDetails] Successfully uploaded report and saved metadata to Firestore.");
        } catch (uploadError) {
          console.error("[StudentDetails] Failed to upload report to Supabase in the background:", uploadError);
        }
      })();
    } catch (blobError) {
      console.error("[StudentDetails] Failed to generate blob for upload:", blobError);
    }
  };

  const handleDownloadQR = () => {
    if (!qrCode) return;
    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `${student.name.replace(/\s+/g, "_")}_Tuition_Payment_QR.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyQRImageToClipboard = async () => {
    if (!qrCode) return;
    try {
      const response = await fetch(qrCode);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob
        })
      ]);
      setCopiedQrImage(true);
      setTimeout(() => setCopiedQrImage(false), 2000);
    } catch (e) {
      console.error("Failed copying QR image", e);
    }
  };

  // Toggle chapter completion logic
  const handleToggleChapter = (ch: typeof activeChaptersList[0]) => {
    if (ch.isReal) {
      onToggleChapterCompletion(selectedProgressSubject, ch.id);
    } else {
      // Convert virtual template to real ChapterNote inside student notes state
      onAddNote(
        selectedProgressSubject,
        ch.chapterNo,
        ch.chapterName,
        "", // no PDF file URL yet
        "", // no PDF original filename
        true // marked complete directly
      );
    }
  };

  // Save/Submit customized remark
  const handleSaveRemark = (ch: typeof activeChaptersList[0]) => {
    if (ch.isReal) {
      onUpdateChapterRemark(selectedProgressSubject, ch.id, editingRemarkText.trim());
    } else {
      // Convert virtual template to real with custom remark
      onAddNote(
        selectedProgressSubject,
        ch.chapterNo,
        ch.chapterName,
        "",
        "",
        ch.isCompleted,
        editingRemarkText.trim()
      );
    }
    setEditingRemarkNoteId(null);
  };

  const handleStartEditingRemark = (ch: typeof activeChaptersList[0]) => {
    setEditingRemarkNoteId(ch.id);
    setEditingRemarkText(ch.remark);
  };

  return (
    <div className="flex flex-col gap-4 pb-24 animate-fadeIn" id={`student-details-${student.id}`}>
      {/* Back Header navigation */}
      <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-2" id="details-back-header">
        {isAdmin && (
          <button
            onClick={onBack}
            className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl transition-all cursor-pointer"
            id="btn-back-to-students"
            title="Back to Students list"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">Student Profile</span>
        </div>
      </div>

      {/* Hero card display */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-4 text-white flex flex-col gap-3 relative overflow-hidden shadow-lg border border-blue-500/10">
        <div className="flex items-center gap-3">
          <div onClick={onOpenAvatarModal} className="relative cursor-pointer group shrink-0" id="avatar-container">
            <div className="w-14 h-14 rounded-full border-2 border-white/80 flex items-center justify-center bg-white shadow-md transition-all duration-300 group-hover:scale-[1.02] overflow-hidden">
              <StudentAvatar
                student={student}
                className="w-full h-full rounded-full"
                initialsClassName="text-xl font-extrabold text-blue-700"
              />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 p-1 bg-blue-600 border border-white text-white rounded-full group-hover:scale-105 transition-all shadow-sm">
              <Camera className="w-3 h-3 stroke-[2.5]" />
            </div>
          </div>

          <div 
            onClick={() => setShowAllDetailsModal(true)}
            className="flex flex-col min-w-0 cursor-pointer group/name hover:opacity-90 transition-all"
            title="Click to view all information"
          >
            <h2 className="text-lg sm:text-xl font-black leading-tight truncate border-b border-dashed border-white/40 group-hover/name:border-white/80 transition-all pb-0.5">
              {student.name}
            </h2>
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-100/70 bg-white/10 px-2.5 py-0.5 rounded-full w-max">
                {student.classGrade}
              </span>
              <span className="text-[9px] font-bold text-blue-100/60 uppercase tracking-wider">
                Joined: {formatRegDate(student.registrationDate)}
              </span>
            </div>
          </div>
        </div>

        <div className="h-[1px] bg-white/10 w-full" />

        <div className="flex justify-between text-[11px] font-semibold text-blue-100/80 gap-2">
          <a href={`tel:${student.phone}`} className="flex items-center gap-1.5 hover:underline min-w-0 truncate">
            <Phone className="w-4 h-4 shrink-0" />
            <span className="truncate">{student.phone}</span>
          </a>
          <div className="flex items-center gap-1.5 shrink-0">
            <CreditCard className="w-4 h-4 shrink-0" />
            <span>₹{student.monthlyFee.toLocaleString("en-IN")}/mo</span>
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex w-full border-b border-slate-100 dark:border-slate-800 gap-1 overflow-x-auto scrollbar-none" id="details-tabs-container">
        {(isAdmin ? ["Profile", "Fee"] : ["Profile", "Progress", "Attendance", "Subjects", "Fee"]).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex-1 py-2.5 text-xs font-extrabold uppercase tracking-wider text-center border-b-2 rounded-none transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-black"
                  : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
              id={`tab-details-${tab.toLowerCase()}`}
            >
              {tab === "Fee" && overdueUnpaidMonths.length > 0 ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span>Fee</span>
                  <span className="bg-rose-500 text-white font-mono text-[9px] px-1.5 py-0.2 rounded-full">
                    !
                  </span>
                </span>
              ) : tab}
            </button>
          );
        })}
      </div>

      {/* Tab details routing content with Swipe gestures support */}
      <div 
        className="mt-1 touch-pan-y" 
        id="details-tab-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* TAB 1: PROFILE */}
        {activeTab === "Profile" && (
          <div className="flex flex-col gap-4 animate-fadeIn">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Core Registry Fields
            </span>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <User className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Student Name</span>
                  <span className="text-slate-800 dark:text-slate-100 font-bold text-sm mt-0.5">{student.name}</span>
                </div>
              </div>

              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Class / Grade</span>
                  <span className="text-slate-800 dark:text-slate-100 font-bold text-sm mt-0.5">{student.classGrade}</span>
                </div>
              </div>

              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Address</span>
                  <span className="text-slate-800 dark:text-slate-100 font-semibold text-sm mt-0.5 truncate">
                    {student.email || "Not provided"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <User className="w-4 h-4" />
                </div>
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Password</span>
                    <span className="text-slate-800 dark:text-slate-100 font-semibold text-sm mt-0.5 break-all">
                      {showStudentPassword ? (student.password || "No password on file") : "••••••••"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowStudentPassword((prev) => !prev)}
                    className="ml-auto p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                    aria-label={showStudentPassword ? "Hide password" : "Show password"}
                  >
                    {showStudentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Phone className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Student Contact Number</span>
                  <a href={`tel:${student.phone}`} className="text-slate-800 dark:text-slate-100 font-semibold text-sm mt-0.5 hover:underline">
                    {student.phone}
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Phone className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Parent's or Guardian contact No.</span>
                  <a href={`tel:${student.parentPhone}`} className="text-slate-800 dark:text-slate-100 font-semibold text-sm mt-0.5 hover:underline">
                    {student.parentPhone}
                  </a>
                </div>
              </div>

              <div className="flex flex-col p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-3xs gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col" />
                  </div>
                  {isAdmin && !isEditingSubjects && (
                    <button
                      onClick={() => {
                        setTempSubjects([...student.enrolledSubjects]);
                        setIsEditingSubjects(true);
                      }}
                      className="px-2.5 py-1 text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-all border border-blue-100/30 cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditingSubjects ? (
                  <div className="flex flex-col gap-3 mt-1" id="inline-subject-editor">
                    {/* Active Temp Tags */}
                    <div className="flex flex-wrap gap-1.5 min-h-[40px] p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                      {tempSubjects.length === 0 ? (
                        <span className="text-xs text-slate-400 p-1">No subjects selected. Add one below.</span>
                      ) : (
                        tempSubjects.map(sub => (
                          <span key={sub} className="inline-flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg text-xs font-bold border border-blue-100/30">
                            <span>{sub}</span>
                            <button
                              type="button"
                              onClick={() => setTempSubjects(tempSubjects.filter(s => s !== sub))}
                              className="text-blue-500 hover:text-rose-600 transition-colors"
                              title={`Remove ${sub}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add Controls */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Type custom subject name..."
                        value={newSubjectInput}
                        onChange={(e) => setNewSubjectInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = newSubjectInput.trim();
                          if (val && !tempSubjects.includes(val)) {
                            setTempSubjects([...tempSubjects, val]);
                            setNewSubjectInput("");
                          }
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>

                    {/* Common Subjects Quick Picks */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Quick Add Common Course:</span>
                      <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto p-1.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-850">
                        {["English", "Hindi", "Nepali", "Science", "Physics", "Chemistry", "Biology", "Mathematics", "Social Science", "Computer Science"].map(subj => {
                          const exists = tempSubjects.includes(subj);
                          return (
                            <button
                              type="button"
                              key={subj}
                              onClick={() => {
                                if (exists) {
                                  setTempSubjects(tempSubjects.filter(s => s !== subj));
                                } else {
                                  setTempSubjects([...tempSubjects, subj]);
                                }
                              }}
                              className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition-all ${
                                exists
                                  ? "bg-blue-600 border-blue-600 text-white"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-850 text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              {subj}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Editor actions */}
                    <div className="flex gap-2 justify-end mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingSubjects(false);
                          setNewSubjectInput("");
                        }}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (onUpdateEnrolledSubjects) {
                            onUpdateEnrolledSubjects(tempSubjects);
                          }
                          setIsEditingSubjects(false);
                          setNewSubjectInput("");
                        }}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-850 dark:text-slate-100 font-semibold text-sm leading-relaxed">
                    {sortedEnrolledSubjects.length > 0 ? sortedEnrolledSubjects.join(", ") : "None Enrolled"}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PROGRESS TRACKER (NEW!) */}
        {activeTab === "Progress" && (
          <div className="flex flex-col gap-4 animate-fadeIn">
            {/* Overall Summary bento cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-900">
              <div className="flex items-center gap-4">
                {/* SVG Circular Donut Chart representing ALL subjects */}
                <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r="18" fill="none" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="3" />
                    <circle cx="20" cy="20" r="18" fill="none" className="stroke-blue-600 dark:stroke-blue-400 transition-all duration-1000" strokeWidth="3"
                      strokeDasharray="113.1"
                      strokeDashoffset={113.1 - (113.1 * collectiveProgressStats.overallPercent / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100">{collectiveProgressStats.overallPercent}%</span>
                    <span className="text-[8px] font-bold uppercase text-slate-400 tracking-tight">Overall</span>
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-blue-500" />
                    Academic Standing
                  </span>
                  <span className="text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">
                    {collectiveProgressStats.standing}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    {collectiveProgressStats.grandCompleted} of {collectiveProgressStats.grandTotal} chapters ready
                  </span>
                </div>
              </div>

              {/* Action buttons side */}
              <div className="flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-slate-200/50 dark:border-slate-800/80 pt-3 sm:pt-0 sm:pl-4 gap-2">
                <button
                  onClick={handleGeneratePdfReport}
                  className="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[11px] font-extrabold uppercase rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/10 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Progress report</span>
                </button>
              </div>
            </div>

            {/* Subject horizontal tab switcher */}
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                Select Course Syllabus
              </span>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {sortedEnrolledSubjects.map((subject) => {
                  const percent = collectiveProgressStats.breakdown[subject]?.percent || 0;
                  const isSel = selectedProgressSubject === subject;

                  return (
                    <button
                      key={subject}
                      onClick={() => {
                        setSelectedProgressSubject(subject);
                        setEditingRemarkNoteId(null);
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                        isSel
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                      }`}
                    >
                      <span>{subject}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-extrabold ${
                        isSel ? "bg-white/20 text-white" : "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                      }`}>
                        {percent}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected subject chapter checklists and details */}
            {selectedProgressSubject && (
              <div className="flex flex-col gap-3 animate-fadeIn mt-1">
                {/* Subject Specific stats display */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                      {selectedProgressSubject} Syllabus Status
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Completed {subjectCompletionStats.completed} out of {subjectCompletionStats.total} chapters
                    </span>
                  </div>

                  <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="18" fill="none" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="3" />
                      <circle cx="20" cy="20" r="18" fill="none" className="stroke-emerald-500 dark:stroke-emerald-400 transition-all duration-500" strokeWidth="3"
                        strokeDasharray="113.1"
                        strokeDashoffset={113.1 - (113.1 * subjectCompletionStats.percent / 100)}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute text-[9px] font-black text-slate-700 dark:text-slate-200">{subjectCompletionStats.percent}%</span>
                  </div>
                </div>

                {/* Chapter Checklist cards */}
                <div className="flex flex-col gap-2.5">
                  {activeChaptersList.map((ch) => {
                    const isEditingThis = editingRemarkNoteId === ch.id;

                    return (
                      <div
                        key={ch.id}
                        className={`p-4 bg-white dark:bg-slate-900 border rounded-2xl shadow-3xs transition-all flex flex-col gap-3 ${
                          ch.isCompleted 
                            ? "border-emerald-100 dark:border-emerald-950/20 bg-emerald-50/5" 
                            : "border-slate-100 dark:border-slate-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            {/* Toggle checkbox */}
                            <button
                              type="button"
                              disabled={!isAdmin}
                              onClick={() => handleToggleChapter(ch)}
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 mt-0.5 ${
                                !isAdmin ? "cursor-default opacity-85" : "cursor-pointer"
                              } ${
                                ch.isCompleted
                                  ? "bg-emerald-500 border-emerald-500 text-white"
                                  : "border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-slate-50 dark:bg-slate-950"
                              }`}
                            >
                              {ch.isCompleted && <Check className="w-3.5 h-3.5 stroke-[3.5]" />}
                            </button>

                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Chapter {ch.chapterNo}
                              </span>
                              <span className="font-extrabold text-slate-800 dark:text-slate-100 text-sm mt-0.5">
                                {ch.chapterName}
                              </span>
                              {ch.pdfFileName && (
                                <span className="text-[10px] text-blue-500 font-semibold flex items-center gap-1 mt-1">
                                  <FileText className="w-3 h-3" />
                                  Attached: {ch.pdfFileName}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              ch.isCompleted 
                                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" 
                                : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                            }`}>
                              {ch.isCompleted ? "Completed" : "Pending"}
                            </span>

                            {isAdmin && ch.id && onDeleteNote && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteNoteTarget({
                                    subject: selectedProgressSubject,
                                    noteId: ch.id!
                                  });
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                                title="Delete Chapter Note"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Remark box */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-850/60 flex flex-col gap-2">
                          {isEditingThis ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Write revision remarks, difficulty level..."
                                value={editingRemarkText}
                                onChange={(e) => setEditingRemarkText(e.target.value)}
                                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden"
                              />
                              <button
                                onClick={() => handleSaveRemark(ch)}
                                className="px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer shrink-0"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>Save</span>
                              </button>
                              <button
                                onClick={() => setEditingRemarkNoteId(null)}
                                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/20 px-3 py-2 rounded-xl border border-slate-100/50 dark:border-slate-850">
                              <span className="text-xs text-slate-500 dark:text-slate-400 italic font-medium leading-relaxed">
                                {ch.remark ? `Tutor Remarks: "${ch.remark}"` : "No remarks added yet."}
                              </span>
                              {isAdmin && (
                                <button
                                  onClick={() => handleStartEditingRemark(ch)}
                                  className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                                >
                                  {ch.remark ? "Edit Remark" : "+ Add Remark"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ATTENDANCE */}
        {activeTab === "Attendance" && (
          <div className="flex flex-col gap-4 animate-fadeIn">
            <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Attendance Log Sheet
              </span>
              <div className="flex justify-between items-center mt-1 text-[10px] sm:text-xs font-bold text-slate-400">
                <span>Present Ratio: {attendanceStats.rate}%</span>
                <span>({attendanceStats.presents} / {attendanceStats.total} marked sessions)</span>
              </div>
            </div>

            {/* Month Selector with Navigation Dropdown */}
            <div className="flex items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Month Navigation</span>
                <span className="text-xs font-black text-slate-800 dark:text-slate-100 mt-0.5">Select Attendance Month</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={attendanceMonth}
                  onChange={(e) => setAttendanceMonth(e.target.value)}
                  className="px-3 py-1.5 text-xs font-bold rounded-xl bg-white dark:bg-slate-950 border border-slate-250 dark:border-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none"
                >
                  {availableAttendanceMonths.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Attendance Logs List */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Attendance Log Entries</span>
                <span className="text-[10px] font-bold text-slate-400">{attendanceHistory.length} Days in Month</span>
              </div>
              
              <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
                {attendanceHistory.map(({ date, dayName, monthName, dayNum, isPresent, isAbsent, isNA, isMarked, isBeforeJoining, isFutureDate }) => {
                  const isDisabled = !isAdmin || isBeforeJoining || isFutureDate;
                  return (
                    <div
                      key={date}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-3xs gap-3"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                          {monthName} {dayNum}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-bold uppercase text-slate-400">
                            {dayName} {date === new Date().toISOString().split("T")[0] ? "(Today)" : ""}
                          </span>
                          {isBeforeJoining && (
                            <span className="px-1.5 py-0.5 text-[8px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-md">
                              Prior to Joining
                            </span>
                          )}
                          {isFutureDate && (
                            <span className="px-1.5 py-0.5 text-[8px] font-black uppercase bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500 rounded-md">
                              Future Date
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1.5 sm:gap-2">
                        <button
                          disabled={isDisabled}
                          onClick={() => onToggleAttendance(date, true)}
                          className={`px-3 py-1.5 text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider rounded-xl border flex items-center gap-1 transition-all ${
                            isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          } ${
                            isMarked && isPresent
                              ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                              : "border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 text-slate-400 hover:text-emerald-600"
                          }`}
                        >
                          <Check className="w-3 h-3 stroke-[3]" />
                          <span>Present</span>
                        </button>

                        <button
                          disabled={isDisabled}
                          onClick={() => onToggleAttendance(date, false)}
                          className={`px-3 py-1.5 text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider rounded-xl border flex items-center gap-1 transition-all ${
                            isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          } ${
                            isMarked && isAbsent
                              ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                              : "border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 text-slate-400 hover:text-rose-600"
                          }`}
                        >
                          <X className="w-3 h-3 stroke-[3]" />
                          <span>Absent</span>
                        </button>

                        <button
                          disabled={isDisabled}
                          onClick={() => onToggleAttendance(date, "na")}
                          className={`px-3 py-1.5 text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider rounded-xl border flex items-center gap-1 transition-all ${
                            isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          } ${
                            isMarked && isNA
                              ? "bg-slate-500 border-slate-500 text-white"
                              : "border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 text-slate-400 hover:text-slate-600"
                          }`}
                        >
                          <AlertCircle className="w-3 h-3" />
                          <span>N/A</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SUBJECTS */}
        {activeTab === "Subjects" && (
          <div className="flex flex-col gap-4 animate-fadeIn">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                Syllabus Chapter Notes
              </span>
              <p className="text-xs text-slate-400 mt-1">
                Select an academic discipline to upload and preview chapters.
              </p>
            </div>

            <div className="flex flex-col mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {student.enrolledSubjects.map((subject) => {
                const notesList = student.notes?.[subject] || [];
                const notesCount = notesList.length;

                return (
                  <div
                    key={subject}
                    onClick={() => onSelectSubject(subject)}
                    className="flex justify-between items-center py-4 group cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-100 text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {subject}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <span>
                        {notesCount > 0 
                          ? `${notesCount} Chapter${notesCount > 1 ? "s" : ""}`
                          : "No PDFs"
                        }
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-700 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 5: MANUAL FEE LEDGER & WHATSAPP ALERTS */}
        {activeTab === "Fee" && (
          <div className="flex flex-col gap-4 animate-fadeIn">
            <div className="flex flex-col gap-1 border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4" />
                March-to-March Financial Ledger
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Logged payments, future terms and arrears
              </span>
            </div>

            {/* List of Tracked Months (Dynamic based on visibleMonths) */}
            <div className="flex flex-col gap-3 max-h-[350px] overflow-y-auto pr-1" id="fee-months-list">
              {visibleMonths.map((month) => {
                // Determine registration date boundary
                const regDate = student.registrationDate || "2026-06-01";
                const [regYearStr, regMonthStr] = regDate.split("-");
                const regYear = parseInt(regYearStr) || 2026;
                const regMonthIdx = (parseInt(regMonthStr) || 6) - 1; // 0-indexed

                const [mName, yStr] = month.split(" ");
                const mIdx = MONTH_NAMES.indexOf(mName);
                const year = parseInt(yStr) || 2026;

                const isBeforeRegistration = year < regYear || (year === regYear && mIdx < regMonthIdx);

                // Default fallback statuses for legacy students
                const getDefaultStatus = (m: string) => {
                  if (m === "June 2026") {
                    return student.id === "student-3" || student.id === "student-5" ? "unpaid" : "paid";
                  }
                  if (m === "July 2026") {
                    return student.feePaidThisMonth ? "paid" : "unpaid";
                  }
                  return "unpaid";
                };

                const feeStatus = getEvaluatedFeeStatus(student, month);
                const isPaid = feeStatus === "PAID";
                const isUnpaid = feeStatus === "UNPAID";
                const isNa = feeStatus === "N/A";
                const paymentDate = student.feePaymentDates?.[month];

                const formatPaymentDateStr = (dateStr?: string) => {
                  if (!dateStr) return "Today";
                  const parts = dateStr.split("-");
                  if (parts.length !== 3) return dateStr;
                  const [y, m, d] = parts.map(Number);
                  const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  return `${d} ${shortMonths[m - 1]} ${y}`;
                };
                
                return (
                  <div 
                    key={month}
                    className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 shadow-3xs ${
                      isUnpaid 
                        ? "border-rose-100 dark:border-rose-950/40 bg-gradient-to-r from-white to-rose-50/10" 
                        : "border-slate-100 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                        {month}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {isPaid ? (
                          <span className="text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Paid {paymentDate ? `on ${formatPaymentDateStr(paymentDate)}` : ""}</span>
                          </span>
                        ) : isUnpaid ? (
                          <span className="text-[10px] font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>Unpaid Pending</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                            Not Applicable (N/A)
                          </span>
                        )}
                        {isUnpaid && (
                          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                            ₹{student.monthlyFee} Due
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Toggle Selector: Paid, Unpaid, N/A */}
                    {isAdmin && (
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() => {
                            const today = new Date().toISOString().split("T")[0];
                            onSetFeeStatus(month, "paid", today);
                          }}
                          className={`px-2.5 py-1.5 text-[9px] font-extrabold uppercase rounded-lg border transition-all cursor-pointer flex items-center gap-0.5 ${
                            isPaid
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 text-slate-500 hover:text-slate-700 bg-white dark:bg-slate-900"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          <span>Paid</span>
                        </button>

                        <button
                          onClick={() => onSetFeeStatus(month, "unpaid")}
                          className={`px-2.5 py-1.5 text-[9px] font-extrabold uppercase rounded-lg border transition-all cursor-pointer flex items-center gap-0.5 ${
                            isUnpaid
                              ? "bg-rose-600 border-rose-600 text-white"
                              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 text-slate-500 hover:text-slate-700 bg-white dark:bg-slate-900"
                          }`}
                        >
                          <X className="w-3 h-3" />
                          <span>Unpaid</span>
                        </button>

                        <button
                          onClick={() => onSetFeeStatus(month, "na")}
                          className={`px-2.5 py-1.5 text-[9px] font-extrabold uppercase rounded-lg border transition-all cursor-pointer flex items-center gap-0.5 ${
                            isNa
                              ? "bg-slate-500 border-slate-500 text-white"
                              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 text-slate-500 hover:text-slate-700 bg-white dark:bg-slate-900"
                          }`}
                        >
                          <span className="text-[9px] font-bold">N/A</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdmin && visibleMonths.length < ALL_ACADEMIC_MONTHS.length && (
              <div className="flex justify-center mt-1">
                <button
                  type="button"
                  onClick={handleAddNextMonthClick}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  id="add-next-month-btn"
                >
                  <Plus className="w-4 h-4 text-blue-500" />
                  <span>+ Add Next Month</span>
                </button>
              </div>
            )}

            {/* Direct QR display in Fee tab itself for quicker visual review */}
            {overdueUnpaidMonths.length > 0 && qrCode && (
              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-850 rounded-2xl flex flex-col items-center justify-center text-center gap-3.5 mt-2 animate-fadeIn">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-blue-500" />
                  Fast Scan UPI Payment QR
                </span>
                <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm relative group">
                  <img src={qrCode} alt="Billing QR Code" className="w-32 h-32 object-contain" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-200">Scan to Settle ₹{totalPendingAmount} Due</span>
                  <span className="text-[9px] text-slate-400 font-semibold">Valid for {institutionName}</span>
                </div>
              </div>
            )}

            {/* Send billing alert button if overdue months exist */}
            {overdueUnpaidMonths.length > 0 ? (
              <button
                onClick={() => setIsReminderOpen(true)}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 cursor-pointer text-sm animate-pulse"
              >
                <MessageSquare className="w-4.5 h-4.5 shrink-0" />
                <span>Compose WhatsApp Billing Alert ({overdueUnpaidMonths.length})</span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* --- WHATSAPP REMINDER BILLING DIALOG --- */}
      {isReminderOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center p-0" id="whatsapp-reminder-modal">
          <div className="absolute inset-0" onClick={() => setIsReminderOpen(false)} />
          
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl animate-slideUp z-10 flex flex-col gap-4 border border-slate-100 dark:border-slate-800 m-0 sm:m-4 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <MessageSquare className="w-5 h-5 text-blue-500" />
                WhatsApp Billing Sheet
              </h2>
              <button
                onClick={() => setIsReminderOpen(false)}
                className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dynamic WhatsApp text preview box */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                WhatsApp Message Text
              </span>
              <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 relative group leading-relaxed">
                <p>{whatsappMessage}</p>
                <button
                  onClick={handleCopyText}
                  className="absolute bottom-2.5 right-2.5 p-1.5 bg-white dark:bg-slate-800 hover:bg-blue-50 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                  title="Copy message to clipboard"
                >
                  {copiedMessage ? <Check className="w-3.5 h-3.5 text-emerald-500 stroke-[3.5]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* GPay/PhonePe QR code display */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Payment QR Code
              </span>
              {qrCode ? (
                <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img 
                      src={qrCode} 
                      alt="GPay QR" 
                      className="w-14 h-14 object-contain rounded-lg border bg-white p-1" 
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">GPay/PhonePe Code Ready</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Copy image to paste it in WhatsApp chat!</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={handleCopyQRImageToClipboard}
                      className={`px-2.5 py-1.5 font-bold text-[10px] rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
                        copiedQrImage
                          ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-500"
                          : "bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                      }`}
                      title="Copy QR Image to Clipboard"
                    >
                      {copiedQrImage ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500 stroke-[3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Copy QR</span>
                    </button>
                    <button
                      onClick={handleDownloadQR}
                      className="p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg transition-all cursor-pointer"
                      title="Download QR"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-yellow-50/50 dark:bg-yellow-950/10 border border-dashed border-yellow-200/50 dark:border-yellow-900/30 rounded-xl text-center text-yellow-700 dark:text-yellow-500 flex flex-col items-center justify-center gap-1">
                  <QrCode className="w-6 h-6 text-yellow-500" />
                  <span className="text-xs font-bold">No Billing QR Code Uploaded</span>
                  <span className="text-[10px] font-medium text-yellow-600/80 mt-0.5">Upload GPay QR in Settings screen to display here.</span>
                </div>
              )}
            </div>

            {/* Direct Action triggers */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
              <button
                onClick={() => {
                  const targetPhone = student.parentPhone ? student.parentPhone : student.phone;
                  handleTriggerWhatsApp(targetPhone, whatsappMessage);
                }}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-500/15 transition-all cursor-pointer text-sm"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send WhatsApp Reminder ({student.parentPhone ? "Parent" : "Student"}: {student.parentPhone || student.phone})</span>
              </button>

              <div className="grid grid-cols-2 gap-2 mt-0.5">
                <button
                  onClick={() => handleTriggerWhatsApp(student.parentPhone, whatsappMessage)}
                  className="py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer text-[11px]"
                  disabled={!student.parentPhone}
                >
                  <span>Parent ({student.parentPhone || "N/A"})</span>
                </button>
                <button
                  onClick={() => handleTriggerWhatsApp(student.phone, whatsappMessage)}
                  className="py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer text-[11px]"
                  disabled={!student.phone}
                >
                  <span>Student ({student.phone || "N/A"})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- ACADEMIC REPORT DIALOG --- */}
      {isReportOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center p-0 animate-fadeIn" id="academic-report-modal">
          <div className="absolute inset-0" onClick={() => setIsReportOpen(false)} />
          
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl animate-slideUp z-10 flex flex-col gap-4 border border-slate-100 dark:border-slate-800 m-0 sm:m-4 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Award className="w-5 h-5 text-indigo-500 animate-bounce" />
                Student Academic Report
              </h2>
              <button
                onClick={() => setIsReportOpen(false)}
                className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dynamic Report text box */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Performance Report Output (Formatted Markdown)
              </span>
              <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 relative group leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                <p>{formattedAcademicReport}</p>
                <button
                  onClick={handleCopyReportText}
                  className="absolute bottom-2.5 right-2.5 p-1.5 bg-white dark:bg-slate-800 hover:bg-blue-50 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                  title="Copy report to clipboard"
                >
                  {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-500 stroke-[3.5]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Direct Action triggers */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 mt-1">
              <button
                onClick={() => handleTriggerWhatsApp(student.parentPhone, formattedAcademicReport)}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-500/10 transition-all cursor-pointer text-xs"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Send Report to Parent WhatsApp ({student.parentPhone})</span>
              </button>
              
              <button
                onClick={() => handleTriggerWhatsApp(student.phone, formattedAcademicReport)}
                className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-800 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer text-xs"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Send Report to Student WhatsApp ({student.phone})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- FULL STUDENT DETAILS MODAL --- */}
      {showAllDetailsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 animate-fadeIn" id="full-student-details-modal" onClick={() => setShowAllDetailsModal(false)}>
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-[28px] p-5 sm:p-6 shadow-2xl animate-scaleIn z-10 flex flex-col max-h-[80vh] border border-slate-100 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-center pb-3.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-slate-100">Full Student Details</h3>
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">All registered information</p>
                </div>
              </div>
              <button
                onClick={() => setShowAllDetailsModal(false)}
                className="rounded-full bg-slate-100 dark:bg-slate-800 p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex flex-col gap-4 mt-4 overflow-y-auto pr-1 flex-1 min-h-0" id="all-details-scroll-body">
              {/* Profile Overview */}
              <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full border border-slate-200/80 flex items-center justify-center bg-white dark:bg-slate-800 shrink-0 overflow-hidden">
                  <StudentAvatar
                    student={student}
                    className="w-full h-full rounded-full"
                    initialsClassName="text-xl font-extrabold text-blue-600 dark:text-blue-400"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 dark:text-slate-100 leading-tight truncate">{student.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">{student.classGrade}</p>
                  <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border border-blue-100/30 px-2 py-0.5 rounded-full mt-2.5 inline-block uppercase tracking-wider">
                    Joined {formatRegDate(student.registrationDate)}
                  </span>
                </div>
              </div>

              {/* Contact Information */}
              <div className="border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col gap-3">
                <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Contact Information
                </span>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Student Phone</span>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-blue-500" />
                      <span>{student.phone || "N/A"}</span>
                    </p>
                  </div>
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Parent Phone</span>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{student.parentPhone || "N/A"}</span>
                    </p>
                  </div>
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40 sm:col-span-2">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Email Address</span>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 flex items-center gap-1.5 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{student.email || "N/A"}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Academic Subjects */}
              <div className="border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col gap-3">
                <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Enrolled Subjects
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {sortedEnrolledSubjects.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">No enrolled subjects</span>
                  ) : (
                    sortedEnrolledSubjects.map((sub) => (
                      <span
                        key={sub}
                        className="text-xs font-bold px-3 py-1 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-full border border-indigo-100/20"
                      >
                        {sub}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Tuition & Financials */}
              <div className="border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col gap-3">
                <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Fee & Financial Summary
                </span>
                <div className="grid gap-3 grid-cols-2">
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Monthly Fee</span>
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100 mt-0.5">
                      ₹{student.monthlyFee.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Total Pending</span>
                    <p className={`text-sm font-black mt-0.5 ${totalPendingAmount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      ₹{totalPendingAmount.toLocaleString("en-IN")}
                    </p>
                  </div>
                </div>
                {overdueUnpaidMonths.length > 0 && (
                  <div className="bg-rose-50/30 dark:bg-rose-950/10 border border-dashed border-rose-100 dark:border-rose-950/40 p-3 rounded-xl">
                    <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wider block mb-1">Unpaid Months ({overdueUnpaidMonths.length})</span>
                    <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{overdueUnpaidMonths.join(", ")}</span>
                  </div>
                )}
              </div>

              {/* Login Credentials */}
              <div className="border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col gap-3">
                <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Portal Login Credentials
                </span>
                <div className="flex flex-col gap-2 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/50 p-3 rounded-xl">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100/40 dark:border-slate-800/30 pb-2">
                    <span className="text-[10px] font-bold text-slate-400">Login User Email:</span>
                    <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 select-all">{student.email || student.phone || "N/A"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[10px] font-bold text-slate-400">Student Password:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 select-all">
                        {showPassInDetailsModal ? (student.password || "N/A") : "••••••••"}
                      </span>
                      <button
                        onClick={() => setShowPassInDetailsModal(!showPassInDetailsModal)}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-lg transition cursor-pointer"
                        title={showPassInDetailsModal ? "Hide password" : "Show password"}
                      >
                        {showPassInDetailsModal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="border border-slate-100 dark:border-slate-800/60 rounded-2xl p-4 flex flex-col gap-3 mb-2">
                <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Tuition Progress Metrics
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Attendance Rate</span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200 mt-1 block">{attendanceStats.rate}%</span>
                    <span className="text-[9px] text-slate-400 mt-0.5 block">{attendanceStats.presents} / {attendanceStats.total} marked days</span>
                  </div>
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100/40 dark:border-slate-800/40">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Syllabus Covered</span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200 mt-1 block">{collectiveProgressStats.overallPercent}%</span>
                    <span className="text-[9px] text-slate-400 mt-0.5 block">{collectiveProgressStats.grandCompleted} / {collectiveProgressStats.grandTotal} chapters completed</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3 flex justify-end shrink-0">
              <button
                onClick={() => setShowAllDetailsModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRM DELETE CHAPTER NOTE MODAL --- */}
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
