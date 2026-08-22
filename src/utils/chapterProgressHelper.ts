import { ChapterNote, ChapterProgressData, Student, ClassNote, TestAttemptRecord } from "../types";
import { safeLocalStorageSetItem } from "../lib/safeStorage";

export interface ProgressStatusConfig {
  label: string;
  percent: number;
  emoji: string;
  badgeClass: string;
  category: "completed" | "in_progress" | "need_revision";
}

export const REMOVED_STATUS_MAPPING: Record<string, string> = {
  "Started Reading": "Reading",
  "Half Completed": "Reading",
  "Almost Completed": "Completed First Reading",
  "MCQs Solved": "PYQs Solved",
  "Revision Pending": "Completed First Reading",
  "Need Revision": "Completed First Reading",
  "Difficult Chapter": "Completed First Reading",
  "Doubts Remaining": "Completed First Reading",
};

export function normalizeStatusLabel(statusLabel?: string | null): string {
  if (!statusLabel || statusLabel.trim() === "") {
    return "Not Started";
  }
  const clean = statusLabel.trim();
  if (REMOVED_STATUS_MAPPING[clean]) {
    return REMOVED_STATUS_MAPPING[clean];
  }
  return clean;
}

export const PROGRESS_STATUS_MAPPING: ProgressStatusConfig[] = [
  {
    label: "Not Started",
    percent: 0,
    emoji: "⚪",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    category: "in_progress"
  },
  {
    label: "Reading",
    percent: 25,
    emoji: "🔵",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900",
    category: "in_progress"
  },
  {
    label: "Completed First Reading",
    percent: 50,
    emoji: "🟢",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    category: "in_progress"
  },
  {
    label: "First Revision Completed",
    percent: 65,
    emoji: "🔷",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900",
    category: "in_progress"
  },
  {
    label: "Second Revision Completed",
    percent: 80,
    emoji: "💜",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-900",
    category: "in_progress"
  },
  {
    label: "Third Revision Completed",
    percent: 90,
    emoji: "⭐",
    badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-900",
    category: "in_progress"
  },
  {
    label: "PYQs Solved",
    percent: 95,
    emoji: "🟣",
    badgeClass: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:border-fuchsia-900",
    category: "in_progress"
  },
  {
    label: "Fully Prepared",
    percent: 100,
    emoji: "🏆",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    category: "completed"
  }
];

export function getStatusConfig(statusLabel?: string | null): ProgressStatusConfig {
  const normalized = normalizeStatusLabel(statusLabel);
  const found = PROGRESS_STATUS_MAPPING.find((s) => s.label === normalized);
  if (found) return found;
  return {
    label: normalized,
    percent: 0,
    emoji: "⚪",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    category: "in_progress"
  };
}

export function getChapterProgressRecord(
  noteId: string,
  subject: string,
  chapterProgressMap?: Record<string, ChapterProgressData>
): ChapterProgressData | null {
  if (!chapterProgressMap) return null;
  const subjClean = (subject || "").trim();
  const keyClean = `${subjClean}_${noteId}`;
  const keyRaw = `${subject}_${noteId}`;
  return chapterProgressMap[keyClean] || chapterProgressMap[keyRaw] || chapterProgressMap[noteId] || null;
}

const OPENED_NOTES_STORAGE_PREFIX = "tuition_student_opened_notes_";

/**
 * Retrieves the set of opened/downloaded note IDs for a student.
 */
export function getOpenedNotesSet(studentId?: string): Set<string> {
  const set = new Set<string>();
  if (typeof window === "undefined" || !window.localStorage) return set;
  try {
    const globalRaw = localStorage.getItem("tuition_opened_notes");
    if (globalRaw) {
      const parsed = JSON.parse(globalRaw);
      if (Array.isArray(parsed)) parsed.forEach((id) => set.add(String(id)));
    }
    if (studentId) {
      const studentRaw = localStorage.getItem(`${OPENED_NOTES_STORAGE_PREFIX}${studentId}`);
      if (studentRaw) {
        const parsed = JSON.parse(studentRaw);
        if (Array.isArray(parsed)) parsed.forEach((id) => set.add(String(id)));
      }
    }
  } catch (err) {
    console.warn("[ChapterProgress] Error reading opened notes cache:", err);
  }
  return set;
}

/**
 * Records that a note has been opened or downloaded by the student.
 * Dispatches a reactive update event to trigger instant live progress recalculation.
 */
export function recordNoteOpenedOrDownloaded(studentId?: string, subject?: string, noteId?: string): void {
  if (!noteId || typeof window === "undefined" || !window.localStorage) return;
  try {
    const noteKey = String(noteId).trim();
    const subjKey = subject ? `${subject.trim()}_${noteKey}` : "";

    // 1. Global storage
    const globalSet = getOpenedNotesSet();
    globalSet.add(noteKey);
    if (subjKey) globalSet.add(subjKey);
    safeLocalStorageSetItem("tuition_opened_notes", JSON.stringify(Array.from(globalSet)));

    // 2. Per-student storage if studentId is provided
    if (studentId) {
      const studentSet = getOpenedNotesSet(studentId);
      studentSet.add(noteKey);
      if (subjKey) studentSet.add(subjKey);
      safeLocalStorageSetItem(`${OPENED_NOTES_STORAGE_PREFIX}${studentId}`, JSON.stringify(Array.from(studentSet)));
    }

    // 3. Dispatch reactive update event
    window.dispatchEvent(new CustomEvent("notes-progress-updated", { detail: { studentId, subject, noteId } }));
  } catch (err) {
    console.warn("[ChapterProgress] Error recording opened note:", err);
  }
}

/**
 * Checks whether a topic note counts as completed (opened/downloaded or status updated).
 */
export function isTopicNoteCompleted(
  note: ChapterNote,
  subject: string,
  student?: Student | null,
  openedSet?: Set<string>
): boolean {
  if (!note) return false;
  if (note.isCompleted) return true;

  const noteId = String(note.id || "").trim();
  const subjClean = (subject || note.subject || "").trim();

  // Check openedSet
  if (openedSet) {
    if (noteId && openedSet.has(noteId)) return true;
    if (subjClean && noteId && openedSet.has(`${subjClean}_${noteId}`)) return true;
  } else if (student?.id) {
    const localOpened = getOpenedNotesSet(student.id);
    if (noteId && localOpened.has(noteId)) return true;
    if (subjClean && noteId && localOpened.has(`${subjClean}_${noteId}`)) return true;
  }

  // Check chapterProgress record on student
  if (student?.chapterProgress) {
    const progRecord = getChapterProgressRecord(note.id, subjClean, student.chapterProgress);
    if (progRecord) {
      const statusConfig = getStatusConfig(progRecord.selectedStatus);
      if (statusConfig.category === "completed" || statusConfig.percent === 100) return true;
      if (
        statusConfig.percent > 0 ||
        (progRecord.selectedStatus && progRecord.selectedStatus !== "Not Started" && progRecord.selectedStatus !== "")
      ) {
        return true;
      }
    }
  }

  return false;
}

import { filterClassNotesForStudent, isSubjectMatching, isClassGradeMatching } from "./classNoteHelper";
import { filterNotesForStudent, isNoteAccessibleToStudent } from "./noteAccessHelper";
import { groupAndSortChapterNotes } from "./chapterNotesHelper";
import { getLocalTestBank } from "../lib/practiceTestService";
import { getTopicPracticeTest } from "./assessmentParser";

export interface SubjectChapterSummary {
  chapterNo: number;
  chapterName: string;
  notes: ChapterNote[];
  isCompleted: boolean;
  statusLabel: string;
  percent: number;
  remark: string;
  topicsWithNotesCount?: number;
  completedNotesCount?: number;
  topicsWithTestsCount?: number;
  attemptedTestsCount?: number;
}

export interface SubjectProgressSummary {
  subject: string;
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  rate: number;
  chapters: SubjectChapterSummary[];
  notesProgress?: number;
  testProgress?: number;
  chapterProgress?: number;
  totalTopicsWithNotes?: number;
  completedNotesCount?: number;
  totalTopicsWithTests?: number;
  attemptedTestsCount?: number;
}

export interface SubjectProgressResult {
  name: string;
  total: number; // total chapters
  completed: number; // completed chapters
  rate: number; // weighted progress percentage (0 - 100)
  notesProgress: number; // 0 - 100
  testProgress: number; // 0 - 100
  chapterProgress: number; // 0 - 100
  totalTopicsWithNotes: number;
  completedNotesCount: number;
  totalTopicsWithTests: number;
  attemptedTestsCount: number;
  notes: ChapterNote[];
  chapters: SubjectChapterSummary[];
}

export interface TopicReportItem {
  topicName: string;
  highestScorePercentage: number;
  highestScoreFormatted: string;
  bestScore: number;
  totalQuestions: number;
  attemptsCount: number;
  weaknessAndStrength: string;
}

export interface ChapterReportItem {
  chapterNo: number;
  chapterName: string;
  chapterProgress: number;
  topics: TopicReportItem[];
}

export interface SubjectReportData {
  subjectName: string;
  overallSubjectPercentage: number;
  totalChapters: number;
  totalTopics: number;
  totalTestsAttempted: number;
  averageHighestScore: number;
  chapters: ChapterReportItem[];
}

export function getFormattedTopicLabel(note: ChapterNote): string {
  if (note.partLabel && note.partLabel.trim() !== "") {
    return note.partLabel.trim();
  }
  if (note.chapterName && note.chapterName.trim() !== "") {
    return note.chapterName.trim();
  }
  return `Topic ${note.chapterNo || 1}`;
}

export function calculateSubjectTestProgress(
  subject: string,
  student: Student,
  allClassNotes: ClassNote[] = [],
  allAttempts: TestAttemptRecord[] = [],
  isAdmin: boolean = false
): SubjectReportData {
  // 1. Get central class notes matching student class & subject
  const studentCentral: ChapterNote[] = (allClassNotes || [])
    .filter((n) => isSubjectMatching(n.subject, subject))
    .filter((n) => {
      if (isAdmin) return true;
      if (!student) return true;
      if (student.classGrade && isClassGradeMatching(n.classGrade, student.classGrade)) return true;
      if (Array.isArray(n.allowedClasses) && n.allowedClasses.some((c) => isClassGradeMatching(c, student.classGrade))) return true;
      if (n.accessType === "selected" && Array.isArray(n.allowedStudentIds) && n.allowedStudentIds.includes(student.id)) return true;
      if (!n.classGrade && (!n.allowedClasses || n.allowedClasses.length === 0)) return true;
      return false;
    })
    .filter((n) => !student || isNoteAccessibleToStudent(n, student.id, isAdmin))
    .map((cn) => ({
      id: cn.id,
      chapterNo: cn.chapterNo,
      chapterName: cn.chapterName,
      partLabel: cn.partLabel,
      pdfUrl: cn.pdfUrl,
      pdfFileName: cn.pdfFileName,
      storagePath: cn.storagePath,
      bucket: cn.bucket,
      createdAt: cn.createdAt,
      subject: cn.subject,
    }));

  // 2. Get legacy notes directly under student.notes
  let legacyRaw: ChapterNote[] = [];
  if (student?.notes) {
    for (const [k, v] of Object.entries(student.notes)) {
      if (isSubjectMatching(k, subject) && Array.isArray(v)) {
        legacyRaw = [...legacyRaw, ...v];
      }
    }
  }
  const legacyFiltered = filterNotesForStudent(legacyRaw, student?.id || "", isAdmin);

  // 3. Combine & deduplicate notes
  const combinedNotes: ChapterNote[] = [...studentCentral];
  for (const leg of legacyFiltered) {
    if (!combinedNotes.some((c) => c.id === leg.id || (leg.storagePath && c.storagePath === leg.storagePath))) {
      combinedNotes.push(leg);
    }
  }

  // 4. Also check test bank practice tests to discover any chapters created as practice tests
  try {
    const testBank = getLocalTestBank();
    if (testBank) {
      Object.values(testBank).forEach((t) => {
        if (
          isSubjectMatching(t.subject, subject) &&
          (isAdmin || !student?.classGrade || isClassGradeMatching(t.classGrade, student.classGrade))
        ) {
          const chNo = Number(t.chapterNo) || 1;
          const exists = combinedNotes.some((n) => Number(n.chapterNo) === chNo);
          if (!exists) {
            combinedNotes.push({
              id: `test_ch_${t.id || chNo}`,
              chapterNo: chNo,
              chapterName: t.chapterName || `Chapter ${chNo}`,
              subject: t.subject || subject,
              partLabel: t.topicName,
              pdfUrl: "",
              pdfFileName: "",
              createdAt: t.createdAt || new Date().toISOString(),
            });
          }
        }
      });
    }
  } catch (_) {}

  // 5. Also check student test attempts in case tests were submitted for chapters not yet in class notes
  if (Array.isArray(allAttempts)) {
    const sId = (student?.id || "").toLowerCase().trim();
    const sName = (student?.name || "").toLowerCase().trim();
    allAttempts.forEach((a) => {
      const aId = (a.studentId || "").toLowerCase().trim();
      const aName = (a.studentName || "").toLowerCase().trim();
      const matchStudent = !student || (aId && sId && aId === sId) || (aName && sName && aName === sName);

      if (matchStudent && isSubjectMatching(a.subject, subject) && a.chapterNo) {
        const chNo = Number(a.chapterNo);
        const exists = combinedNotes.some((n) => Number(n.chapterNo) === chNo);
        if (!exists) {
          combinedNotes.push({
            id: `att_ch_${chNo}`,
            chapterNo: chNo,
            chapterName: a.chapterName || `Chapter ${chNo}`,
            subject: a.subject || subject,
            partLabel: a.topicName,
            pdfUrl: "",
            pdfFileName: "",
            createdAt: a.date || new Date().toISOString(),
          });
        }
      }
    });
  }

  // 6. Group into chapters
  const chapterGroups = groupAndSortChapterNotes(combinedNotes);

  let totalTopics = 0;
  let totalTestsAttempted = 0;
  let sumTopicHighestScores = 0;

  const chapters: ChapterReportItem[] = chapterGroups.map((group) => {
    const topicSet = new Map<string, string>(); // normKey -> topicLabel
    group.notes.forEach((n) => {
      const topicLabel = getFormattedTopicLabel(n);
      const normKey = topicLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!topicSet.has(normKey)) {
        topicSet.set(normKey, topicLabel);
      }
    });

    if (topicSet.size === 0) {
      topicSet.set(`topic_${group.chapterNo}`, group.chapterName || `Chapter ${group.chapterNo} Topic`);
    }

    let chapterTopicSumPct = 0;
    const chapterTopicsList: TopicReportItem[] = [];

    topicSet.forEach((displayTopic, normKey) => {
      // Find topic test attempts
      const topicAttempts = allAttempts.filter((a) => {
        const sId = (student?.id || "").toLowerCase().trim();
        const sName = (student?.name || "").toLowerCase().trim();
        const aId = (a.studentId || "").toLowerCase().trim();
        const aName = (a.studentName || "").toLowerCase().trim();

        const matchesStudent =
          !student ||
          (aId && sId && aId === sId) ||
          (aName && sName && aName === sName) ||
          (aId && sName && aId === sName) ||
          (aName && sId && aName === sId);

        if (!matchesStudent) return false;
        if (a.testType !== "topic") return false;
        if (!isSubjectMatching(a.subject, subject)) return false;
        if (Number(a.chapterNo) !== Number(group.chapterNo)) return false;
        const aNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return aNorm === normKey || aNorm.includes(normKey) || normKey.includes(aNorm);
      });

      const attemptsCount = topicAttempts.length;
      totalTestsAttempted += attemptsCount;

      let bestScore = 0;
      let totalQuestions = 0;
      let highestScorePercentage = 0;

      if (attemptsCount > 0) {
        let bestRatio = -1;
        topicAttempts.forEach((a) => {
          const ratio = a.totalQuestions > 0 ? a.score / a.totalQuestions : 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestScore = a.score;
            totalQuestions = a.totalQuestions;
          }
        });
        highestScorePercentage = Math.round(bestRatio * 100);
      }

      chapterTopicSumPct += highestScorePercentage;
      sumTopicHighestScores += highestScorePercentage;
      totalTopics++;

      let weaknessAndStrength = "";
      let highestScoreFormatted = "";

      if (attemptsCount === 0) {
        highestScoreFormatted = "Not Attempted (0%)";
        weaknessAndStrength = "Requires Revision";
      } else {
        highestScoreFormatted = `${highestScorePercentage}% (${bestScore}/${totalQuestions})`;
        if (highestScorePercentage < 85) {
          weaknessAndStrength = "Requires Revision";
        } else {
          weaknessAndStrength = "Mastered";
        }
      }

      chapterTopicsList.push({
        topicName: displayTopic,
        highestScorePercentage,
        highestScoreFormatted,
        bestScore,
        totalQuestions,
        attemptsCount,
        weaknessAndStrength,
      });
    });

    const topicCount = chapterTopicsList.length;
    const chapterProgress = topicCount > 0 ? Math.round(chapterTopicSumPct / topicCount) : 0;

    return {
      chapterNo: group.chapterNo,
      chapterName: group.chapterName || `Chapter ${group.chapterNo}`,
      chapterProgress,
      topics: chapterTopicsList,
    };
  });

  const totalChapters = chapters.length;
  const sumChapterProgress = chapters.reduce((acc, c) => acc + c.chapterProgress, 0);
  const overallSubjectPercentage = totalChapters > 0 ? Math.round(sumChapterProgress / totalChapters) : 0;
  const averageHighestScore = totalTopics > 0 ? Math.round(sumTopicHighestScores / totalTopics) : 0;

  return {
    subjectName: subject,
    overallSubjectPercentage,
    totalChapters,
    totalTopics,
    totalTestsAttempted,
    averageHighestScore,
    chapters,
  };
}

/**
 * Calculates the exact weighted learning progress for a subject using the
 * Subject → Chapter → Topic hierarchy.
 *
 * Formula:
 * 1. Notes Progress: completedNotes / totalTopicsWithNotes (Topic counts as completed if notes opened/downloaded)
 * 2. Practice Test Progress: average of latest scores per topic with test (0% if unattempted)
 * 3. Chapter Completion: completedChapters / totalChapters (Chapter is complete only if notes are opened AND practice test is attempted)
 * 4. Final Subject Progress: (Practice Test Avg * 0.40) + (Notes Completion * 0.40) + (Chapter Completion * 0.20)
 */
export function calculateSubjectWeightedProgress(
  subject: string,
  student: Student,
  allClassNotes: ClassNote[] = [],
  allAttempts: TestAttemptRecord[] = [],
  isAdmin: boolean = false
): SubjectProgressResult {
  // 1. Get central class notes matching student class & subject
  const studentCentral: ChapterNote[] = (allClassNotes || [])
    .filter((n) => isSubjectMatching(n.subject, subject))
    .filter((n) => {
      if (isAdmin) return true;
      if (!student) return true;
      if (student.classGrade && isClassGradeMatching(n.classGrade, student.classGrade)) return true;
      if (Array.isArray(n.allowedClasses) && n.allowedClasses.some((c) => isClassGradeMatching(c, student.classGrade))) return true;
      if (n.accessType === "selected" && Array.isArray(n.allowedStudentIds) && n.allowedStudentIds.includes(student.id)) return true;
      if (!n.classGrade && (!n.allowedClasses || n.allowedClasses.length === 0)) return true;
      return false;
    })
    .filter((n) => !student || isNoteAccessibleToStudent(n, student.id, isAdmin))
    .map((cn) => ({
      id: cn.id,
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
      subject: cn.subject,
      classGrade: cn.classGrade,
    }));

  // 2. Get legacy notes directly under student.notes
  let legacyRaw: ChapterNote[] = [];
  if (student?.notes) {
    for (const [k, v] of Object.entries(student.notes)) {
      if (isSubjectMatching(k, subject) && Array.isArray(v)) {
        legacyRaw = [...legacyRaw, ...v];
      }
    }
  }
  const legacyFiltered = filterNotesForStudent(legacyRaw, student?.id || "", isAdmin);

  // 3. Combine & deduplicate notes
  const combinedNotes: ChapterNote[] = [...studentCentral];
  for (const leg of legacyFiltered) {
    if (!combinedNotes.some((c) => c.id === leg.id || (leg.storagePath && c.storagePath === leg.storagePath))) {
      combinedNotes.push(leg);
    }
  }

  // 4. Also check test bank practice tests to discover any chapters created as practice tests
  const testBank = getLocalTestBank() || {};
  try {
    Object.values(testBank).forEach((t) => {
      if (
        isSubjectMatching(t.subject, subject) &&
        (isAdmin || !student?.classGrade || isClassGradeMatching(t.classGrade, student.classGrade))
      ) {
        const chNo = Number(t.chapterNo) || 1;
        const exists = combinedNotes.some((n) => Number(n.chapterNo) === chNo);
        if (!exists) {
          combinedNotes.push({
            id: `test_ch_${t.id || chNo}`,
            chapterNo: chNo,
            chapterName: t.chapterName || `Chapter ${chNo}`,
            subject: t.subject || subject,
            partLabel: t.topicName,
            pdfUrl: "",
            pdfFileName: "",
            createdAt: t.createdAt || new Date().toISOString(),
          });
        }
      }
    });
  } catch (_) {}

  // 5. Also check student test attempts in case tests were submitted for chapters not yet in class notes
  if (Array.isArray(allAttempts)) {
    const sId = (student?.id || "").toLowerCase().trim();
    const sName = (student?.name || "").toLowerCase().trim();
    allAttempts.forEach((a) => {
      const aId = (a.studentId || "").toLowerCase().trim();
      const aName = (a.studentName || "").toLowerCase().trim();
      const matchStudent = !student || (aId && sId && aId === sId) || (aName && sName && aName === sName);

      if (matchStudent && isSubjectMatching(a.subject, subject) && a.chapterNo) {
        const chNo = Number(a.chapterNo);
        const exists = combinedNotes.some((n) => Number(n.chapterNo) === chNo);
        if (!exists) {
          combinedNotes.push({
            id: `att_ch_${chNo}`,
            chapterNo: chNo,
            chapterName: a.chapterName || `Chapter ${chNo}`,
            subject: a.subject || subject,
            partLabel: a.topicName,
            pdfUrl: "",
            pdfFileName: "",
            createdAt: a.date || new Date().toISOString(),
          });
        }
      }
    });
  }

  // 6. Group notes by chapter
  const chapterGroups = groupAndSortChapterNotes(combinedNotes);
  const openedSet = getOpenedNotesSet(student?.id);

  let totalTopicsWithNotes = 0;
  let completedNotesCount = 0;
  let totalTopicsWithTests = 0;
  let sumTestScores = 0;
  let attemptedTestsCount = 0;
  let completedChaptersCount = 0;

  const sId = (student?.id || "").toLowerCase().trim();
  const sName = (student?.name || "").toLowerCase().trim();

  const chaptersSummary: SubjectChapterSummary[] = chapterGroups.map((group) => {
    const chapterNotes = group.notes;
    let chapterTopicsWithNotes = 0;
    let chapterCompletedNotes = 0;
    let chapterTopicsWithTests = 0;
    let chapterAttemptedTests = 0;
    let mainRemark = "";

    chapterNotes.forEach((n) => {
      const hasNoteFile = Boolean(
        n.pdfUrl || n.storagePath || (!n.id.startsWith("test_ch_") && !n.id.startsWith("att_ch_"))
      );
      const topicLabel = getFormattedTopicLabel(n);
      const normTopic = (topicLabel || "").toLowerCase().replace(/[^a-z0-9]/g, "");

      if (hasNoteFile) {
        totalTopicsWithNotes++;
        chapterTopicsWithNotes++;
        const isCompleted = isTopicNoteCompleted(n, subject, student, openedSet);
        if (isCompleted) {
          completedNotesCount++;
          chapterCompletedNotes++;
        }
      }

      // Check practice test for this topic
      const test = getTopicPracticeTest(
        student?.classGrade || n.classGrade || "",
        subject || n.subject || "",
        group.chapterNo,
        topicLabel
      );

      const hasTest = !!(test && Array.isArray(test.questions) && test.questions.length > 0);
      if (hasTest) {
        totalTopicsWithTests++;
        chapterTopicsWithTests++;

        // Find student attempts for this topic
        const attempts = (allAttempts || []).filter((a) => {
          const aId = (a.studentId || "").toLowerCase().trim();
          const aName = (a.studentName || "").toLowerCase().trim();
          const matchesStudent =
            !student ||
            (aId && sId && aId === sId) ||
            (aName && sName && aName === sName) ||
            (aId && sName && aId === sName) ||
            (aName && sId && aName === sId);

          if (!matchesStudent) return false;
          if (a.testType !== "topic") return false;
          if (!isSubjectMatching(a.subject, subject)) return false;
          if (Number(a.chapterNo) !== Number(group.chapterNo)) return false;
          const aNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return aNorm === normTopic || aNorm.includes(normTopic) || normTopic.includes(aNorm);
        });

        if (attempts.length > 0) {
          attempts.sort((a, b) => {
            const timeA = a.timestamp || (a.date ? new Date(a.date).getTime() : 0);
            const timeB = b.timestamp || (b.date ? new Date(b.date).getTime() : 0);
            return timeB - timeA;
          });
          chapterAttemptedTests++;
          attemptedTestsCount++;
          // Get the latest attempt score percentage
          const latestAttempt = attempts[0];
          const latestScore =
            latestAttempt.percentage ??
            (latestAttempt.totalQuestions > 0
              ? (latestAttempt.score / latestAttempt.totalQuestions) * 100
              : 0);
          sumTestScores += Math.min(100, Math.max(0, latestScore));
        } else {
          // Unattempted counts as 0%
          sumTestScores += 0;
        }
      }

      const progRecord = getChapterProgressRecord(n.id, subject, student?.chapterProgress);
      const remark = progRecord?.remarks || n.remark || "";
      if (remark && !mainRemark) mainRemark = remark;
    });

    // Chapter completion criteria:
    // A Chapter is complete ONLY IF:
    // 1) All topics with notes are opened/downloaded
    // 2) All topics with practice tests are attempted
    // 3) There is at least 1 topic/component in this chapter
    const notesAllComplete = chapterTopicsWithNotes === 0 || chapterCompletedNotes >= chapterTopicsWithNotes;
    const testsAllAttempted = chapterTopicsWithTests === 0 || chapterAttemptedTests >= chapterTopicsWithTests;
    const hasAnyComponent = chapterTopicsWithNotes > 0 || chapterTopicsWithTests > 0;
    const isChapterCompleted = hasAnyComponent && notesAllComplete && testsAllAttempted;

    if (isChapterCompleted) {
      completedChaptersCount++;
    }

    let statusLabel = "Not Started";
    let percent = 0;
    if (isChapterCompleted) {
      statusLabel = "Completed";
      percent = 100;
    } else if (chapterCompletedNotes > 0 || chapterAttemptedTests > 0) {
      statusLabel = "In Progress";
      percent = 50;
    }

    return {
      chapterNo: group.chapterNo,
      chapterName: group.chapterName,
      notes: chapterNotes,
      isCompleted: isChapterCompleted,
      statusLabel,
      percent,
      remark: mainRemark,
      topicsWithNotesCount: chapterTopicsWithNotes,
      completedNotesCount: chapterCompletedNotes,
      topicsWithTestsCount: chapterTopicsWithTests,
      attemptedTestsCount: chapterAttemptedTests,
    };
  });

  const totalChapters = chaptersSummary.length;
  const chapterCompletionRate = totalChapters > 0 ? (completedChaptersCount / totalChapters) * 100 : 0;
  const notesProgress = totalTopicsWithNotes > 0 ? (completedNotesCount / totalTopicsWithNotes) * 100 : 0;
  const testProgress = totalTopicsWithTests > 0 ? sumTestScores / totalTopicsWithTests : 0;

  let finalRate = 0;
  if (totalTopicsWithTests > 0 && totalTopicsWithNotes > 0) {
    // Standard 40/40/20 formula
    finalRate = Math.round(testProgress * 0.4 + notesProgress * 0.4 + chapterCompletionRate * 0.2);
  } else if (totalTopicsWithNotes > 0) {
    // Only notes exist for this subject: (Notes * 0.80) + (Chapter * 0.20)
    finalRate = Math.round(notesProgress * 0.8 + chapterCompletionRate * 0.2);
  } else if (totalTopicsWithTests > 0) {
    // Only tests exist for this subject: (Tests * 0.80) + (Chapter * 0.20)
    finalRate = Math.round(testProgress * 0.8 + chapterCompletionRate * 0.2);
  } else {
    finalRate = 0;
  }

  finalRate = Math.min(100, Math.max(0, finalRate));

  return {
    name: subject,
    total: totalChapters,
    completed: completedChaptersCount,
    rate: finalRate,
    notesProgress: Math.round(notesProgress),
    testProgress: Math.round(testProgress),
    chapterProgress: Math.round(chapterCompletionRate),
    totalTopicsWithNotes,
    completedNotesCount,
    totalTopicsWithTests,
    attemptedTestsCount,
    notes: combinedNotes,
    chapters: chaptersSummary,
  };
}

export function calculateSubjectProgress(
  subject: string,
  student: Student,
  allClassNotes: ClassNote[] = [],
  isAdmin: boolean = false
): SubjectProgressSummary {
  const result = calculateSubjectWeightedProgress(subject, student, allClassNotes, [], isAdmin);

  const inProgress = result.chapters.filter((c) => c.statusLabel === "In Progress").length;
  const notStarted = result.chapters.filter((c) => c.statusLabel === "Not Started").length;

  return {
    subject,
    total: result.total,
    completed: result.completed,
    inProgress,
    notStarted,
    rate: result.rate,
    chapters: result.chapters,
    notesProgress: result.notesProgress,
    testProgress: result.testProgress,
    chapterProgress: result.chapterProgress,
    totalTopicsWithNotes: result.totalTopicsWithNotes,
    completedNotesCount: result.completedNotesCount,
    totalTopicsWithTests: result.totalTopicsWithTests,
    attemptedTestsCount: result.attemptedTestsCount,
  };
}
