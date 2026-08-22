import { ClassNote, Student, ChapterNote } from "../types";

export function normalizeClassGrade(grade?: string): string {
  if (!grade) return "";
  const trimmed = grade.trim();
  if (/^upsc$/i.test(trimmed) || /^class\s+upsc$/i.test(trimmed)) {
    return "UPSC";
  }
  const match = trimmed.match(/\d+/);
  if (match) {
    return `Class ${match[0]}`;
  }
  // Check roman numerals (e.g. Class X, Class IX, etc.)
  const romanMap: Record<string, number> = {
    xii: 12, xi: 11, x: 10, ix: 9, viii: 8, vii: 7, vi: 6, v: 5, iv: 4, iii: 3, ii: 2, i: 1
  };
  const cleanGrade = trimmed.toLowerCase().replace(/class|grade|std|standard/g, "").trim();
  if (cleanGrade && romanMap[cleanGrade]) {
    return `Class ${romanMap[cleanGrade]}`;
  }
  if (/^class/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export function isClassGradeMatching(gradeA?: string, gradeB?: string): boolean {
  if (!gradeA || !gradeB) return false;
  const normA = normalizeClassGrade(gradeA).toLowerCase();
  const normB = normalizeClassGrade(gradeB).toLowerCase();
  return normA === normB;
}

export function isSubjectMatching(subA?: string, subB?: string): boolean {
  if (!subA || !subB) return false;
  const a = subA.trim().toLowerCase();
  const b = subB.trim().toLowerCase();
  if (a === b) return true;

  // Common subject aliases and normalizations
  const isMathA = a === "math" || a === "maths" || a === "mathematics";
  const isMathB = b === "math" || b === "maths" || b === "mathematics";
  if (isMathA && isMathB) return true;

  const isSciA = a === "sci" || a === "science" || a === "general science";
  const isSciB = b === "sci" || b === "science" || b === "general science";
  if (isSciA && isSciB) return true;

  const isEngA = a === "eng" || a === "english" || a === "english grammar" || a === "english literature";
  const isEngB = b === "eng" || b === "english" || b === "english grammar" || b === "english literature";
  if (isEngA && isEngB) return true;

  const isPhyA = a === "phy" || a === "physics";
  const isPhyB = b === "phy" || b === "physics";
  if (isPhyA && isPhyB) return true;

  const isChemA = a === "chem" || a === "chemistry";
  const isChemB = b === "chem" || b === "chemistry";
  if (isChemA && isChemB) return true;

  const isBioA = a === "bio" || a === "biology";
  const isBioB = b === "bio" || b === "biology";
  if (isBioA && isBioB) return true;

  const isSstA = a === "sst" || a === "social science" || a === "social studies" || a === "social";
  const isSstB = b === "sst" || b === "social science" || b === "social studies" || b === "social";
  if (isSstA && isSstB) return true;

  const isCsA = a === "cs" || a === "computer science" || a === "computer" || a === "it" || a === "information technology";
  const isCsB = b === "cs" || b === "computer science" || b === "computer" || b === "it" || b === "information technology";
  if (isCsA && isCsB) return true;

  return false;
}

/**
 * Filter centralized ClassNote items for a given student.
 * Must match:
 * 1. Student's ClassGrade
 * 2. Student's EnrolledSubjects
 */
export function filterClassNotesForStudent(
  classNotes: ClassNote[],
  student: Student
): ClassNote[] {
  if (!student || !Array.isArray(classNotes)) return [];
  const studentGrade = student.classGrade || "";
  const enrolledSubjects = (student.enrolledSubjects || []).map((s) => s.trim().toLowerCase());
  const hasEnrolledList = Array.isArray(student.enrolledSubjects) && student.enrolledSubjects.length > 0;

  return classNotes.filter((note) => {
    if (!note) return false;
    const studentNormGrade = normalizeClassGrade(studentGrade).toLowerCase();

    // 1. Check class grade access
    let classMatches = false;
    const isExplicitlyShared = Array.isArray(note.allowedClasses) && note.allowedClasses.length > 0;

    if (isExplicitlyShared) {
      const allowedNorm = note.allowedClasses!.map((c) => normalizeClassGrade(c).toLowerCase());
      classMatches = allowedNorm.includes(studentNormGrade) || allowedNorm.some((g) => isClassGradeMatching(g, studentGrade));
    } else if (note.accessType === "selected" && Array.isArray(note.allowedStudentIds) && note.allowedStudentIds.length > 0) {
      classMatches = note.allowedStudentIds.includes(student.id);
    } else {
      classMatches = isClassGradeMatching(note.classGrade, studentGrade);
    }

    if (!classMatches) return false;

    // 2. Check subject match: MUST be in student's enrolledSubjects list
    const noteSubj = (note.subject || "").trim();
    if (!hasEnrolledList) return true;
    const subjectMatches = enrolledSubjects.some((s) => isSubjectMatching(s, noteSubj));

    return subjectMatches;
  });
}

export interface GroupedChapterParts {
  chapterNo: number;
  chapterName: string;
  parts: ClassNote[];
}

export interface GroupedSubjectChapters {
  subject: string;
  chapters: GroupedChapterParts[];
}

export interface GroupedClassNotes {
  classGrade: string;
  subjects: GroupedSubjectChapters[];
}

/**
 * Group ClassNotes into Class -> Subject -> Chapter -> Parts hierarchy.
 */
export function groupClassNotesHierarchy(notes: ClassNote[]): GroupedClassNotes[] {
  const classMap = new Map<string, Map<string, Map<string, ClassNote[]>>>();

  for (const note of notes) {
    const normalizedClass = normalizeClassGrade(note.classGrade);
    const subject = note.subject.trim();
    const chapterKey = `${note.chapterNo}:::${note.chapterName.trim()}`;

    if (!classMap.has(normalizedClass)) {
      classMap.set(normalizedClass, new Map());
    }
    const subjectMap = classMap.get(normalizedClass)!;

    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, new Map());
    }
    const chapterMap = subjectMap.get(subject)!;

    if (!chapterMap.has(chapterKey)) {
      chapterMap.set(chapterKey, []);
    }
    chapterMap.get(chapterKey)!.push(note);
  }

  const result: GroupedClassNotes[] = [];

  // Sort classes numerical order e.g. Class 6, Class 7, Class 8, Class 9, Class 10...
  const sortedClasses = Array.from(classMap.keys()).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 999;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 999;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });

  for (const cls of sortedClasses) {
    const subjectMap = classMap.get(cls)!;
    const sortedSubjects = Array.from(subjectMap.keys()).sort((a, b) => a.localeCompare(b));
    const subjectGroups: GroupedSubjectChapters[] = [];

    for (const subj of sortedSubjects) {
      const chapterMap = subjectMap.get(subj)!;
      const chapterGroups: GroupedChapterParts[] = [];

      const sortedChapterKeys = Array.from(chapterMap.keys()).sort((a, b) => {
        const [chNoA] = a.split(":::");
        const [chNoB] = b.split(":::");
        return (parseInt(chNoA, 10) || 0) - (parseInt(chNoB, 10) || 0);
      });

      for (const chKey of sortedChapterKeys) {
        const [chNoStr, chName] = chKey.split(":::");
        const chapterNo = parseInt(chNoStr, 10) || 0;
        const parts = chapterMap.get(chKey)!;
        
        if (!parts || parts.length === 0) continue;

        // Sort parts if partLabel exists, e.g. Part 1, Part 2
        parts.sort((p1, p2) => {
          const l1 = (p1.partLabel || "").toLowerCase();
          const l2 = (p2.partLabel || "").toLowerCase();
          if (!l1 && !l2) return 0;
          if (!l1) return -1;
          if (!l2) return 1;
          return l1.localeCompare(l2, undefined, { numeric: true });
        });

        chapterGroups.push({
          chapterNo,
          chapterName: chName || `Chapter ${chapterNo}`,
          parts,
        });
      }

      if (chapterGroups.length > 0) {
        subjectGroups.push({
          subject: subj,
          chapters: chapterGroups,
        });
      }
    }

    if (subjectGroups.length > 0) {
      result.push({
        classGrade: cls,
        subjects: subjectGroups,
      });
    }
  }

  return result;
}

/**
 * Automatically migrates legacy notes stored in students[].notes into centralized ClassNote[].
 * Ensures no duplicate PDFs exist based on storagePath or pdfUrl or id.
 */
export function migrateLegacyNotesToClassNotes(
  students: Student[],
  existingClassNotes: ClassNote[]
): { migratedNotes: ClassNote[]; addedCount: number } {
  const resultNotes = [...existingClassNotes];
  const existingKeys = new Set<string>();

  for (const n of existingClassNotes) {
    if (n.storagePath) existingKeys.add(`path:${n.storagePath}`);
    if (n.pdfUrl && !n.pdfUrl.startsWith("data:")) existingKeys.add(`url:${n.pdfUrl}`);
    existingKeys.add(`id:${n.id}`);
  }

  let addedCount = 0;

  for (const student of students) {
    const studentClass = normalizeClassGrade(student.classGrade || "Class 10");
    if (!student.notes) continue;

    for (const [subject, chapterNotes] of Object.entries(student.notes)) {
      if (!Array.isArray(chapterNotes)) continue;

      for (const note of chapterNotes) {
        const pathKey = note.storagePath ? `path:${note.storagePath}` : "";
        const urlKey = note.pdfUrl && !note.pdfUrl.startsWith("data:") ? `url:${note.pdfUrl}` : "";
        const idKey = `id:${note.id}`;

        if (
          (pathKey && existingKeys.has(pathKey)) ||
          (urlKey && existingKeys.has(urlKey)) ||
          existingKeys.has(idKey)
        ) {
          continue; // Skip duplicate
        }

        const newClassNote: ClassNote = {
          id: note.id || `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          classGrade: studentClass,
          subject: subject,
          chapterNo: note.chapterNo || 1,
          chapterName: note.chapterName || "General Chapter",
          partLabel: (note as any).partLabel || "",
          pdfUrl: note.pdfUrl || "",
          pdfFileName: note.pdfFileName || note.fileName || `Chapter_${note.chapterNo || 1}.pdf`,
          storagePath: note.storagePath || "",
          bucket: note.bucket || "",
          createdAt: note.createdAt || new Date().toISOString(),
          uploadedBy: "Admin Migration",
        };

        resultNotes.push(newClassNote);
        if (pathKey) existingKeys.add(pathKey);
        if (urlKey) existingKeys.add(urlKey);
        existingKeys.add(idKey);
        addedCount++;
      }
    }
  }

  return { migratedNotes: resultNotes, addedCount };
}
