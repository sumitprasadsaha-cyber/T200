import { ChapterNote } from "../types";

/**
 * Checks if a note is accessible to a given student.
 * Admins can always access all notes.
 * Existing notes without an explicit accessType default to "all".
 */
export function isNoteAccessibleToStudent(
  note: ChapterNote,
  studentId?: string | null,
  isAdmin: boolean = false
): boolean {
  if (isAdmin) return true;
  if (!studentId) return false;
  if (!note.accessType || note.accessType === "all") return true;
  if (note.accessType === "selected") {
    return Array.isArray(note.allowedStudentIds) && note.allowedStudentIds.includes(studentId);
  }
  return true;
}

/**
 * Filters an array of notes for a specific student.
 */
export function filterNotesForStudent(
  notes: ChapterNote[],
  studentId?: string | null,
  isAdmin: boolean = false
): ChapterNote[] {
  if (isAdmin) return notes;
  if (!studentId) return [];
  return notes.filter((note) => isNoteAccessibleToStudent(note, studentId, isAdmin));
}

/**
 * Filters a list of enrolled subjects for a student based on note access rules.
 * If a subject contains notes, the student must have access to at least one note/chapter to see that subject.
 * If a subject has 0 notes uploaded yet, it remains visible for the enrolled student.
 */
export function filterSubjectsForStudent(
  enrolledSubjects: string[],
  allNotesBySubject: Record<string, ChapterNote[]>,
  studentId?: string | null,
  isAdmin: boolean = false
): string[] {
  if (isAdmin) return enrolledSubjects;
  if (!studentId) return [];

  return enrolledSubjects.filter((subject) => {
    const subjectNotes = allNotesBySubject[subject] || [];
    if (subjectNotes.length === 0) {
      // If no notes are uploaded for this subject yet, display the subject
      return true;
    }
    // Check if student has access to at least one chapter/note in this subject
    return subjectNotes.some((note) => isNoteAccessibleToStudent(note, studentId, false));
  });
}
