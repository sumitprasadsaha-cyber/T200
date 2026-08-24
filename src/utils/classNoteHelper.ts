import { ClassNote, Student, ChapterNote } from "../types";

export function normalizeClassGrade(grade?: string): string {
  if (!grade) return "";
  const trimmed = grade.trim();
  if (/^upsc$/i.test(trimmed) || /^class\s+upsc$/i.test(trimmed) || /upsc/i.test(trimmed)) {
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

  // Universal match for "all" or "all subjects"
  if (a === "all" || a === "all subjects" || b === "all" || b === "all subjects") return true;

  // UPSC specific subject aliases (Strict 1-to-1 canonical group matching, never bleed across different subjects)
  const isPolityA = a === "polity" || a === "political science" || a === "polity & governance" || a === "polity and governance" || a === "indian polity" || a === "governance" || a === "constitution";
  const isPolityB = b === "polity" || b === "political science" || b === "polity & governance" || b === "polity and governance" || b === "indian polity" || b === "governance" || b === "constitution";
  if (isPolityA && isPolityB) return true;

  const isEconA = a === "economics" || a === "economy" || a === "indian economy" || a === "eco";
  const isEconB = b === "economics" || b === "economy" || b === "indian economy" || b === "eco";
  if (isEconA && isEconB) return true;

  const isHistA = a === "history" || a === "indian history" || a === "ancient history" || a === "medieval history" || a === "modern history" || a === "hist";
  const isHistB = b === "history" || b === "indian history" || b === "ancient history" || b === "medieval history" || b === "modern history" || b === "hist";
  if (isHistA && isHistB) return true;

  const isGeoA = a === "geography" || a === "physical geography" || a === "indian geography" || a === "world geography" || a === "geo";
  const isGeoB = b === "geography" || b === "physical geography" || b === "indian geography" || b === "world geography" || b === "geo";
  if (isGeoA && isGeoB) return true;

  const isEnvA = a === "environment" || a === "ecology" || a === "environment & ecology" || a === "environment and ecology" || a === "env";
  const isEnvB = b === "environment" || b === "ecology" || b === "environment & ecology" || b === "environment and ecology" || b === "env";
  if (isEnvA && isEnvB) return true;

  const isSciTechA = a === "science & technology" || a === "science and technology" || a === "science & tech" || a === "sci & tech" || a === "s&t" || a === "science & tech.";
  const isSciTechB = b === "science & technology" || b === "science and technology" || b === "science & tech" || b === "sci & tech" || b === "s&t" || b === "science & tech.";
  if (isSciTechA && isSciTechB) return true;

  const isIrA = a === "international relations" || a === "ir" || a === "international affairs";
  const isIrB = b === "international relations" || b === "ir" || b === "international affairs";
  if (isIrA && isIrB) return true;

  const isEthicsA = a === "ethics" || a === "ethics & integrity" || a === "ethics, integrity & aptitude" || a === "ethics and integrity" || a === "ethics, integrity and aptitude";
  const isEthicsB = b === "ethics" || b === "ethics & integrity" || b === "ethics, integrity & aptitude" || b === "ethics and integrity" || b === "ethics, integrity and aptitude";
  if (isEthicsA && isEthicsB) return true;

  const isCaA = a === "current affairs" || a === "current issues" || a === "daily current affairs" || a === "ca";
  const isCaB = b === "current affairs" || b === "current issues" || b === "daily current affairs" || b === "ca";
  if (isCaA && isCaB) return true;

  const isGsA = a === "general studies" || a === "gs";
  const isGsB = b === "general studies" || b === "gs";
  if (isGsA && isGsB) return true;

  const isCsatA = a === "csat" || a === "aptitude" || a === "general mental ability" || a === "paper 2";
  const isCsatB = b === "csat" || b === "aptitude" || b === "general mental ability" || b === "paper 2";
  if (isCsatA && isCsatB) return true;

  // General academic subject aliases
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
 * 1. Student's ClassGrade (Class 1–12, UPSC)
 * 2. Student's explicitly assigned/enrolled subjects
 * 3. Specific note access rules (if selected student access is configured)
 */
export function filterClassNotesForStudent(
  classNotes: ClassNote[],
  student: Student
): ClassNote[] {
  if (!student || !Array.isArray(classNotes)) return [];
  
  const enrolledSubjects = (student.enrolledSubjects || [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim().toLowerCase());

  // If student has no assigned subjects, return empty list
  if (enrolledSubjects.length === 0) {
    return [];
  }

  const studentGrade = student.classGrade || "";
  const studentNormGrade = normalizeClassGrade(studentGrade).toLowerCase();

  return classNotes.filter((note) => {
    if (!note || !note.subject || !note.subject.trim()) return false;

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

    // 2. Check student explicit access restriction if specified
    if (note.accessType === "selected" && Array.isArray(note.allowedStudentIds)) {
      if (!note.allowedStudentIds.includes(student.id)) return false;
    }

    // 3. Check subject match strictly against enrolled subjects
    const noteSubj = (note.subject || "").trim();
    return enrolledSubjects.some((s) => isSubjectMatching(s, noteSubj));
  });
}

/**
 * Returns only the subjects assigned/enrolled to the student.
 * Never falls back to returning all class subjects, UPSC default subjects, or unassigned central notes.
 */
export function getStudentSubjects(student: Student, _allClassNotes: ClassNote[] = []): string[] {
  if (!student || !Array.isArray(student.enrolledSubjects)) return [];

  const subjectsSet = new Set<string>();

  student.enrolledSubjects.forEach((sub) => {
    if (typeof sub === "string" && sub.trim()) {
      subjectsSet.add(sub.trim());
    }
  });

  return Array.from(subjectsSet).sort((a, b) => a.localeCompare(b));
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

export interface GroupedGSPaperSubjects {
  gsPaper: string;
  subjects: GroupedSubjectChapters[];
}

export interface GroupedClassNotes {
  classGrade: string;
  subjects: GroupedSubjectChapters[];
  gsPapers?: GroupedGSPaperSubjects[];
}

/**
 * Standard UPSC General Studies Papers in canonical order.
 */
export const UPSC_GS_PAPERS_CANONICAL = [
  "General Studies Paper I",
  "General Studies Paper II",
  "General Studies Paper III",
  "General Studies Paper IV",
  "Essay",
  "CSAT"
];

export function getGSPaperSortIndex(paper: string): number {
  const norm = (paper || "").toLowerCase().trim();
  if (norm.includes("paper i") && !norm.includes("paper ii") && !norm.includes("paper iii") && !norm.includes("paper iv")) return 1;
  if (norm.includes("paper ii") && !norm.includes("paper iii")) return 2;
  if (norm.includes("paper iii")) return 3;
  if (norm.includes("paper iv")) return 4;
  if (norm.includes("essay")) return 5;
  if (norm.includes("csat")) return 6;
  return 99;
}

export function inferGSPaperFromSubject(subject?: string): string {
  if (!subject) return "General Studies Paper I";
  const s = subject.toLowerCase().trim();
  if (s.includes("ethics")) return "General Studies Paper IV";
  if (s.includes("polity") || s.includes("governance") || s.includes("international relations") || s.includes("ir") || s.includes("constitution")) return "General Studies Paper II";
  if (s.includes("economy") || s.includes("economics") || s.includes("environment") || s.includes("ecology") || s.includes("science") || s.includes("tech")) return "General Studies Paper III";
  if (s.includes("history") || s.includes("geography") || s.includes("heritage") || s.includes("culture") || s.includes("society")) return "General Studies Paper I";
  if (s.includes("essay")) return "Essay";
  if (s.includes("csat") || s.includes("aptitude") || s.includes("reasoning")) return "CSAT";
  return "General Studies Paper I";
}

/**
 * Sanitize folder and file names by replacing spaces with _ and removing invalid filesystem characters.
 */
export function sanitizeUPSCPathSegment(segment: string): string {
  if (!segment) return "";
  return segment
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Format GS Paper into a canonical storage folder name e.g. "GS_Paper_II".
 */
export function formatGSPaperFolderName(gsPaper: string): string {
  const clean = (gsPaper || "General Studies Paper I").trim();
  const romanMap: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
  const m = clean.match(/^(?:General\s+Studies\s+Paper|GS\s+Paper|Paper)\s*([IVXivx\d]+)/i);
  if (m) {
    const numOrRoman = m[1].toUpperCase();
    const roman = romanMap[numOrRoman] || numOrRoman;
    return `GS_Paper_${roman}`;
  }
  if (/^essay$/i.test(clean)) return "Essay";
  if (/^csat$/i.test(clean)) return "CSAT";
  return sanitizeUPSCPathSegment(clean.replace(/^General\s+Studies\s+Paper/i, "GS_Paper")) || "GS_Paper_I";
}

/**
 * Generate UPSC Supabase Storage Path adhering strictly to:
 * UPSC/{gs_paper}/{subject}/Module_{module_number}_{module_name}/Topic_{topic_number}_{topic_name}.{extension}
 */
export function generateUPSCStoragePath(
  gsPaper: string,
  subject: string,
  moduleNo: number | string,
  moduleName: string,
  topicNo?: number | string,
  topicName?: string,
  originalFileName?: string,
  extension?: string
): { storagePath: string; fileName: string } {
  const gsFolder = formatGSPaperFolderName(gsPaper);
  const subjFolder = sanitizeUPSCPathSegment(subject) || "General_Studies";
  
  const mNo = Number(moduleNo) || 1;
  const mName = sanitizeUPSCPathSegment(moduleName) || `Module_${mNo}`;
  const moduleFolder = `Module_${mNo}_${mName}`;

  let ext = (extension || "").replace(/^\./, "").toLowerCase();
  if (!ext && originalFileName && originalFileName.includes(".")) {
    ext = originalFileName.split(".").pop()!.toLowerCase();
  }
  if (!ext) ext = "pdf";

  const tNo = topicNo !== undefined && topicNo !== "" ? topicNo : 1;
  let tName = topicName ? sanitizeUPSCPathSegment(topicName) : "";
  if (!tName && originalFileName) {
    const nameWithoutExt = originalFileName.replace(/\.[^/.]+$/, "");
    tName = sanitizeUPSCPathSegment(nameWithoutExt);
  }
  if (!tName) {
    tName = mName;
  }

  const fileName = `Topic_${tNo}_${tName}.${ext}`;
  const storagePath = `UPSC/${gsFolder}/${subjFolder}/${moduleFolder}/${fileName}`.replace(/\/+/g, "/");

  return { storagePath, fileName };
}

/**
 * Group ClassNotes into Class -> Subject -> Chapter -> Parts hierarchy.
 * For UPSC only: groups into UPSC -> General Studies Paper -> Subject -> Module -> Topic.
 */
export function groupClassNotesHierarchy(notes: ClassNote[]): GroupedClassNotes[] {
  const classMap = new Map<string, ClassNote[]>();

  for (const note of notes) {
    const normalizedClass = normalizeClassGrade(note.classGrade);
    if (!classMap.has(normalizedClass)) {
      classMap.set(normalizedClass, []);
    }
    classMap.get(normalizedClass)!.push(note);
  }

  const result: GroupedClassNotes[] = [];

  // Sort classes numerical order e.g. Class 6, Class 7, Class 8, Class 9, Class 10... and UPSC
  const sortedClasses = Array.from(classMap.keys()).sort((a, b) => {
    if (a === "UPSC") return 1;
    if (b === "UPSC") return -1;
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 999;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 999;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });

  for (const cls of sortedClasses) {
    const classNotes = classMap.get(cls) || [];

    if (cls === "UPSC") {
      // ----------------------------------------------------
      // UPSC HIERARCHY: UPSC -> GS Paper -> Subject -> Module -> Topics
      // ----------------------------------------------------
      const gsPaperMap = new Map<string, Map<string, Map<string, ClassNote[]>>>();

      for (const note of classNotes) {
        const gsPaper = (note.generalStudiesPaper || (note as any).gs_paper || inferGSPaperFromSubject(note.subject) || "General Studies Paper I").trim();
        const subject = note.subject.trim();
        const chapterNo = note.chapterNo || (note as any).moduleNo || (note as any).module_number || 1;
        const chapterName = (note.chapterName || (note as any).moduleName || (note as any).module_name || `Module ${chapterNo}`).trim();
        const moduleKey = `${chapterNo}:::${chapterName}`;

        if (!gsPaperMap.has(gsPaper)) {
          gsPaperMap.set(gsPaper, new Map());
        }
        const subjMap = gsPaperMap.get(gsPaper)!;

        if (!subjMap.has(subject)) {
          subjMap.set(subject, new Map());
        }
        const modMap = subjMap.get(subject)!;

        if (!modMap.has(moduleKey)) {
          modMap.set(moduleKey, []);
        }
        modMap.get(moduleKey)!.push(note);
      }

      // Sort GS Papers in canonical order
      const sortedGSPapers = Array.from(gsPaperMap.keys()).sort((a, b) => {
        const idxA = getGSPaperSortIndex(a);
        const idxB = getGSPaperSortIndex(b);
        if (idxA !== idxB) return idxA - idxB;
        return a.localeCompare(b);
      });

      const gsPaperGroups: GroupedGSPaperSubjects[] = [];
      const aggregatedSubjectGroups: GroupedSubjectChapters[] = [];

      for (const gsPaper of sortedGSPapers) {
        const subjMap = gsPaperMap.get(gsPaper)!;
        const sortedSubjects = Array.from(subjMap.keys()).sort((a, b) => a.localeCompare(b));
        const gsSubjectGroups: GroupedSubjectChapters[] = [];

        for (const subj of sortedSubjects) {
          const modMap = subjMap.get(subj)!;
          const moduleGroups: GroupedChapterParts[] = [];

          const sortedModKeys = Array.from(modMap.keys()).sort((a, b) => {
            const [mNoA] = a.split(":::");
            const [mNoB] = b.split(":::");
            return (parseInt(mNoA, 10) || 0) - (parseInt(mNoB, 10) || 0);
          });

          for (const mKey of sortedModKeys) {
            const [mNoStr, mName] = mKey.split(":::");
            const moduleNo = parseInt(mNoStr, 10) || 0;
            const parts = modMap.get(mKey)!;

            if (!parts || parts.length === 0) continue;

            // Sort topics numerically / alphabetically
            parts.sort((p1, p2) => {
              const t1 = p1.topicNo !== undefined ? Number(p1.topicNo) : undefined;
              const t2 = p2.topicNo !== undefined ? Number(p2.topicNo) : undefined;
              if (t1 !== undefined && t2 !== undefined && !isNaN(t1) && !isNaN(t2)) {
                return t1 - t2;
              }
              const l1 = (p1.partLabel || p1.topicName || "").toLowerCase();
              const l2 = (p2.partLabel || p2.topicName || "").toLowerCase();
              if (!l1 && !l2) return 0;
              if (!l1) return -1;
              if (!l2) return 1;
              return l1.localeCompare(l2, undefined, { numeric: true });
            });

            moduleGroups.push({
              chapterNo: moduleNo,
              chapterName: mName || `Module ${moduleNo}`,
              parts,
            });
          }

          if (moduleGroups.length > 0) {
            const subjObj: GroupedSubjectChapters = {
              subject: subj,
              chapters: moduleGroups,
            };
            gsSubjectGroups.push(subjObj);
            aggregatedSubjectGroups.push(subjObj);
          }
        }

        if (gsSubjectGroups.length > 0) {
          gsPaperGroups.push({
            gsPaper,
            subjects: gsSubjectGroups,
          });
        }
      }

      result.push({
        classGrade: "UPSC",
        subjects: aggregatedSubjectGroups,
        gsPapers: gsPaperGroups,
      });

    } else {
      // ----------------------------------------------------
      // CLASSES 1–12 HIERARCHY: Class -> Subject -> Chapter -> Topics (Unchanged)
      // ----------------------------------------------------
      const subjectMap = new Map<string, Map<string, ClassNote[]>>();

      for (const note of classNotes) {
        const subject = note.subject.trim();
        const chapterKey = `${note.chapterNo}:::${note.chapterName.trim()}`;

        if (!subjectMap.has(subject)) {
          subjectMap.set(subject, new Map());
        }
        const chapterMap = subjectMap.get(subject)!;

        if (!chapterMap.has(chapterKey)) {
          chapterMap.set(chapterKey, []);
        }
        chapterMap.get(chapterKey)!.push(note);
      }

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
    const studentClass = normalizeClassGrade(student.classGrade);
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
