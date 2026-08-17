import { ChapterNote, ChapterProgressData, Student, ClassNote, TestAttemptRecord } from "../types";

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

import { filterClassNotesForStudent, isSubjectMatching, isClassGradeMatching } from "./classNoteHelper";
import { filterNotesForStudent, isNoteAccessibleToStudent } from "./noteAccessHelper";
import { groupAndSortChapterNotes } from "./chapterNotesHelper";
import { getLocalTestBank } from "../lib/practiceTestService";

export interface SubjectChapterSummary {
  chapterNo: number;
  chapterName: string;
  notes: ChapterNote[];
  isCompleted: boolean;
  statusLabel: string;
  percent: number;
  remark: string;
}

export interface SubjectProgressSummary {
  subject: string;
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  rate: number;
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

export function calculateSubjectProgress(
  subject: string,
  student: Student,
  allClassNotes: ClassNote[] = [],
  isAdmin: boolean = false
): SubjectProgressSummary {
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

  // 5. Group by Chapter Number into umbrella Chapters
  const chapterGroups = groupAndSortChapterNotes(combinedNotes);

  const chaptersSummary: SubjectChapterSummary[] = chapterGroups.map((group) => {
    const chapterNotes = group.notes;
    let completedParts = 0;
    let startedParts = 0;
    let mainRemark = "";

    chapterNotes.forEach((n) => {
      const progRecord = getChapterProgressRecord(n.id, subject, student.chapterProgress);
      const statusConfig = progRecord ? getStatusConfig(progRecord.selectedStatus) : null;
      const isPartCompleted = (statusConfig && statusConfig.category === "completed") || !!n.isCompleted;
      const isPartStarted = isPartCompleted || (statusConfig && statusConfig.label !== "Not Started" && statusConfig.label !== "");
      const remark = progRecord?.remarks || n.remark || "";

      if (isPartCompleted) completedParts++;
      if (isPartStarted) startedParts++;
      if (remark && !mainRemark) mainRemark = remark;
    });

    const isCompleted = chapterNotes.length > 0 && completedParts === chapterNotes.length;
    let statusLabel = "Not Started";
    let percent = 0;

    if (isCompleted) {
      statusLabel = "Completed";
      percent = 100;
    } else if (startedParts > 0 || completedParts > 0) {
      statusLabel = "In Progress";
      percent = 50;
    }

    return {
      chapterNo: group.chapterNo,
      chapterName: group.chapterName,
      notes: chapterNotes,
      isCompleted,
      statusLabel,
      percent,
      remark: mainRemark,
    };
  });

  const total = chaptersSummary.length;
  const completed = chaptersSummary.filter((c) => c.isCompleted).length;
  const inProgress = chaptersSummary.filter((c) => c.statusLabel === "In Progress").length;
  const notStarted = chaptersSummary.filter((c) => c.statusLabel === "Not Started").length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    subject,
    total,
    completed,
    inProgress,
    notStarted,
    rate,
    chapters: chaptersSummary,
  };
}
