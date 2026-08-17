import { Student, AIReportType, AICachedReport } from "../types";
import { safeLocalStorageSetItem, safeLocalStorageGetItem } from "./safeStorage";

const CACHE_PREFIX = "tuition_ai_cache_";

/**
 * Transforms full raw Student array into a concise, structured JSON payload
 * removing heavy binary/base64 strings to optimize token usage and latency.
 */
export function buildStructuredPayload(
  students: Student[],
  filterContext?: {
    studentId?: string;
    classGrade?: string;
    month?: string;
    communicationType?: string;
  }
) {
  const currentMonth = "July 2026"; // Current operational month

  const studentData = students.map((s) => {
    // Calculate attendance metrics
    const attendanceEntries = Object.entries(s.attendance || {}).filter(([_, v]) => v !== "na");
    const totalDays = attendanceEntries.length;
    const presentDays = attendanceEntries.filter(([_, v]) => v === true).length;
    const attendancePercentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 100;

    // Calculate homework metrics if available
    const hwRecords = s.homeworkRecords || [];
    const hwTotal = hwRecords.length;
    const hwCompleted = hwRecords.filter((h) => h.completed).length;
    const hwPercentage = hwTotal > 0 ? Math.round((hwCompleted / hwTotal) * 100) : 85; // default estimate

    // Calculate test performance average if available
    const tests = s.testMarks || [];
    let avgTestScore = 0;
    if (tests.length > 0) {
      const sum = tests.reduce((acc, t) => acc + (t.marksObtained / (t.totalMarks || 100)) * 100, 0);
      avgTestScore = Math.round(sum / tests.length);
    } else {
      // derive estimated test score from attendance & fees if no explicit tests
      avgTestScore = attendancePercentage > 80 ? 82 : 65;
    }

    // Determine current fee status
    const feeStatus = s.feeMonths?.[currentMonth] || (s.feePaidThisMonth ? "paid" : "unpaid");

    return {
      id: s.id,
      name: s.name,
      classGrade: s.classGrade,
      phone: s.phone,
      parentPhone: s.parentPhone,
      monthlyFee: s.monthlyFee,
      registrationDate: s.registrationDate || "2026-01-01",
      enrolledSubjects: s.enrolledSubjects || [],
      feeStatusThisMonth: feeStatus,
      feeLedger: s.feeMonths || {},
      attendancePercentage,
      totalAttendanceDaysRecorded: totalDays,
      tests: tests.map((t) => ({
        subject: t.subject,
        testName: t.testName,
        score: `${t.marksObtained}/${t.totalMarks}`,
        percentage: Math.round((t.marksObtained / (t.totalMarks || 100)) * 100),
        date: t.date,
      })),
      avgTestScore,
      homeworkCompletionPercentage: hwPercentage,
      homeworkSummary: hwRecords,
      syllabusProgress: s.syllabusProgress || {
        "Mathematics": 65,
        "Science": 70,
        "English": 80,
      },
      studyMaterialUsage: s.studyMaterialUsage || [
        { subject: "Mathematics", chaptersViewed: 8, totalChapters: 12 },
        { subject: "Science", chaptersViewed: 10, totalChapters: 14 },
      ],
      adminNotes: s.adminNotes || "Regular attendee.",
    };
  });

  // Calculate high-level institution metrics
  const totalStudents = studentData.length;
  const activeStudents = totalStudents;
  const totalAttendanceSum = studentData.reduce((acc, s) => acc + s.attendancePercentage, 0);
  const avgAttendance = totalStudents > 0 ? Math.round(totalAttendanceSum / totalStudents) : 0;
  
  const totalRevenueThisMonth = studentData
    .filter((s) => s.feeStatusThisMonth === "paid")
    .reduce((acc, s) => acc + s.monthlyFee, 0);
  
  const totalPendingFees = studentData
    .filter((s) => s.feeStatusThisMonth === "unpaid")
    .reduce((acc, s) => acc + s.monthlyFee, 0);

  const atRiskStudents = studentData.filter(
    (s) => s.attendancePercentage < 75 || s.feeStatusThisMonth === "unpaid" || s.avgTestScore < 60
  ).length;

  const avgTestScoreInst = totalStudents > 0
    ? Math.round(studentData.reduce((acc, s) => acc + s.avgTestScore, 0) / totalStudents)
    : 0;

  const avgHwCompletionInst = totalStudents > 0
    ? Math.round(studentData.reduce((acc, s) => acc + s.homeworkCompletionPercentage, 0) / totalStudents)
    : 0;

  return {
    institution: {
      totalStudents,
      activeStudents,
      inactiveStudents: 0,
      averageAttendancePercentage: avgAttendance,
      collectionThisMonth: totalRevenueThisMonth,
      pendingFees: totalPendingFees,
      studentsAtRiskCount: atRiskStudents,
      averageTestScore: avgTestScoreInst,
      homeworkCompletionRatePercentage: avgHwCompletionInst,
      currentMonth,
    },
    filterContext,
    students: filterContext?.studentId
      ? studentData.filter((s) => s.id === filterContext.studentId)
      : filterContext?.classGrade
      ? studentData.filter((s) => s.classGrade === filterContext.classGrade)
      : studentData,
  };
}

/**
 * Retrieves cached AI report from localStorage if available
 */
export function getCachedReport(cacheKey: string): AICachedReport | null {
  try {
    const raw = safeLocalStorageGetItem(`${CACHE_PREFIX}${cacheKey}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Error reading AI cache:", e);
  }
  return null;
}

/**
 * Saves generated AI report to localStorage
 */
export function saveCachedReport(cacheKey: string, reportType: AIReportType, markdown: string) {
  try {
    const record: AICachedReport = {
      reportType,
      key: cacheKey,
      markdown,
      updatedAt: new Date().toISOString(),
    };
    safeLocalStorageSetItem(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify(record));
  } catch (e) {
    console.warn("Error saving AI cache:", e);
  }
}

/**
 * Sends request to backend AI service (/api/ai/report)
 * Handles offline detection and cached report fallback gracefully.
 */
export async function generateAIReport(
  reportType: AIReportType,
  students: Student[],
  filterContext?: {
    studentId?: string;
    classGrade?: string;
    month?: string;
    communicationType?: string;
  },
  promptExtra?: string,
  forceRefresh: boolean = false
): Promise<{ markdown: string; isCached: boolean; updatedAt?: string }> {
  const cacheKey = `${reportType}_${filterContext?.studentId || "all"}_${filterContext?.classGrade || "all"}_${filterContext?.communicationType || "none"}`;

  // Check offline state
  const isOnline = navigator.onLine;

  if (!forceRefresh) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return {
        markdown: cached.markdown,
        isCached: true,
        updatedAt: cached.updatedAt,
      };
    }
  }

  if (!isOnline) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return {
        markdown: cached.markdown,
        isCached: true,
        updatedAt: cached.updatedAt,
      };
    }
    throw new Error("AI Insights require an internet connection.");
  }

  const payload = buildStructuredPayload(students, filterContext);

  const res = await fetch("/api/ai/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType,
      dataPayload: payload,
      promptExtra,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server responded with status ${res.status}`);
  }

  const data = await res.json();
  const markdown = data.markdown || "No markdown returned by AI.";

  // Save to offline cache
  saveCachedReport(cacheKey, reportType, markdown);

  return {
    markdown,
    isCached: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Sends interactive query to AI Chat endpoint (/api/ai/chat)
 */
export async function askAIChat(
  query: string,
  students: Student[],
  history?: { role: "user" | "model"; text: string }[]
): Promise<string> {
  if (!navigator.onLine) {
    throw new Error("AI Insights require an internet connection.");
  }

  const contextPayload = buildStructuredPayload(students);

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      dataContext: contextPayload,
      history,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to reach AI Chat endpoint.");
  }

  const data = await res.json();
  return data.reply || "Sorry, I could not generate an answer.";
}
