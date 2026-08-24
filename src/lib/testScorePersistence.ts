/**
 * Student Practice Test Score Persistence Service
 * 
 * Provides complete cross-device synchronization for student practice test scores using Supabase.
 * Enforces per-student isolation, duplicate attempt prevention, and instant real-time UI updates.
 */

import { supabase } from "./supabaseClient";
import { TestAttemptRecord } from "../types";
import { 
  getLocalTestAttempts, 
  saveLocalTestAttemptsCache, 
  saveTestAttemptDoc, 
  subscribeToTestAttempts 
} from "./firestoreService";
import {
  downloadFromR2,
  uploadToR2,
  deleteFromR2,
  deleteMultipleFromR2,
  listFromR2,
  getR2BucketName,
} from "./r2Client";

const PRACTICE_TESTS_BUCKET = getR2BucketName();
const TEST_SCORE_CACHE_KEY = "tuition_student_test_score_cache";

async function downloadJsonFromR2<T>(key: string): Promise<T | null> {
  try {
    const { blob } = await downloadFromR2({ bucket: PRACTICE_TESTS_BUCKET, key });
    if (blob) {
      const text = await blob.text();
      if (text) return JSON.parse(text) as T;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

async function uploadJsonToR2(key: string, data: any): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    await uploadToR2({ bucket: PRACTICE_TESTS_BUCKET, key, file: blob, mimeType: "application/json" });
  } catch (err) {
    console.warn(`[ScorePersistence] R2 upload error for ${key}:`, err);
  }
}

// In-memory cache for fast, synchronous UI reads
let inMemoryAttempts: TestAttemptRecord[] = [];

// Session cache for student scores per topic & student to eliminate redundant network requests
const scoreSessionCache = new Map<string, TestAttemptRecord | null>();
const inFlightScoreRequests = new Map<string, Promise<TestAttemptRecord | null>>();

function cleanId(str?: string): string {
  if (!str) return "";
  return str.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
}

function getStudentAttemptStoragePath(studentId: string): string {
  const cId = cleanId(studentId) || "unknown_student";
  return `practice_tests/student_attempts/student_${cId}.json`;
}

/**
 * Normalizes attempts and removes duplicates, keeping the latest / highest score attempt
 * per topic for a student.
 */
export function deduplicateAttempts(attempts: TestAttemptRecord[]): TestAttemptRecord[] {
  if (!Array.isArray(attempts)) return [];
  const map = new Map<string, TestAttemptRecord>();

  attempts.forEach((a) => {
    if (!a) return;
    const studentKey = cleanId(a.studentId) || cleanId(a.studentName);
    const testType = a.testType || "topic";
    const topicNorm = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    const key = `${studentKey}__${a.classGrade || ""}__${a.subject || ""}__${a.chapterNo || 0}__${topicNorm}__${testType}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, a);
    } else {
      const existingPct = existing.percentage ?? (existing.totalQuestions > 0 ? (existing.score / existing.totalQuestions) * 100 : 0);
      const newPct = a.percentage ?? (a.totalQuestions > 0 ? (a.score / a.totalQuestions) * 100 : 0);

      const existingTime = existing.timestamp || 0;
      const newTime = a.timestamp || 0;

      if (newTime > existingTime || (newTime === existingTime && newPct >= existingPct)) {
        map.set(key, {
          ...existing,
          ...a,
          attemptNumber: Math.max(existing.attemptNumber || 1, a.attemptNumber || 1)
        });
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Fetch a student's practice test attempts directly from Supabase Storage & DB.
 * Synchronizes across devices seamlessly on login and screen load.
 */
export async function fetchStudentTestAttemptsFromSupabase(
  studentId: string,
  studentName?: string
): Promise<TestAttemptRecord[]> {
  const cId = cleanId(studentId) || cleanId(studentName);
  if (!cId) return [];

  let remoteAttempts: TestAttemptRecord[] = [];

  // 1. Fetch student-specific JSON file from Cloudflare R2 bucket
  try {
    const filePath = getStudentAttemptStoragePath(studentId);
    const parsed = await downloadJsonFromR2<TestAttemptRecord[]>(filePath);
    if (Array.isArray(parsed)) {
      remoteAttempts = parsed;
    }
  } catch (err) {
    console.warn(`[ScorePersistence] Error downloading per-student file for ${studentId} from R2:`, err);
  }

  // 2. Also query Supabase DB Table if it exists
  try {
    const { data: dbData, error: dbErr } = await supabase
      .from("student_practice_test_attempts")
      .select("*")
      .or(`student_id.eq.${studentId},student_id.eq.${cId}`);

    if (!dbErr && dbData && Array.isArray(dbData) && dbData.length > 0) {
      const converted: TestAttemptRecord[] = dbData.map((row) => ({
        id: row.id || `att_${row.timestamp || Date.now()}`,
        studentId: row.student_id || studentId,
        studentName: row.student_name || studentName || "",
        testId: row.test_id,
        topicId: row.topic_id,
        chapterId: row.chapter_id,
        subjectId: row.subject_id,
        classGrade: row.class_grade || "",
        subject: row.subject || "",
        chapterNo: row.chapter_no || 0,
        chapterName: row.chapter_name || "",
        topicName: row.topic_name || "",
        testType: row.test_type || "topic",
        attemptNumber: row.attempt_number || 1,
        date: row.date || new Date().toISOString(),
        timestamp: row.timestamp || Date.now(),
        timeTakenSeconds: row.time_taken_seconds || 0,
        score: row.score || 0,
        totalMarks: row.total_marks || row.total_questions || 0,
        totalQuestions: row.total_questions || 0,
        percentage: row.percentage || 0,
        correctAnswersCount: row.correct_answers_count || 0,
        wrongAnswersCount: row.wrong_answers_count || 0,
        userAnswers: row.user_answers || {}
      }));
      remoteAttempts = [...remoteAttempts, ...converted];
    }
  } catch (err) {
    // DB table might not exist; Storage fallback works
  }

  // 3. Fallback: Download global test_attempts.json from Cloudflare R2
  if (remoteAttempts.length === 0) {
    try {
      const parsed = await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json");
      if (Array.isArray(parsed)) {
        const studentMatches = parsed.filter((a) => {
          if (!a) return false;
          const aId = cleanId(a.studentId);
          const aName = cleanId(a.studentName);
          return (studentId && aId === cId) || (studentName && aName === cleanId(studentName));
        });
        remoteAttempts = [...remoteAttempts, ...studentMatches];
      }
    } catch (err) {
      console.warn("[ScorePersistence] Global file download fallback warning from R2:", err);
    }
  }

  // Deduplicate and merge into memory & local cache
  const cleanRemote = deduplicateAttempts(remoteAttempts);

  if (cleanRemote.length > 0) {
    mergeAttemptsIntoMemoryAndCache(cleanRemote);
    notifyScoreUpdate();
  }

  return cleanRemote;
}

/**
 * Saves or updates a practice test attempt in Supabase Storage and Supabase DB.
 * Prevents duplicates and ensures score synchronization across all devices.
 */
export async function savePracticeTestAttemptToSupabase(
  attempt: TestAttemptRecord
): Promise<TestAttemptRecord> {
  if (!attempt || !attempt.studentId) {
    throw new Error("Invalid attempt record: missing studentId");
  }

  const studentId = attempt.studentId;
  const cId = cleanId(studentId) || cleanId(attempt.studentName);
  const topicNorm = (attempt.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const testType = attempt.testType || "topic";
  const cacheKey = `${cId}__${(attempt.classGrade || "").toLowerCase().trim()}__${(attempt.subject || "").toLowerCase().trim()}__${attempt.chapterNo || 0}__${topicNorm}__${testType}`;

  // 1. INSTANT LOCAL UPDATE: Update session cache, memory cache, and local storage synchronously
  scoreSessionCache.set(cacheKey, attempt);
  mergeAttemptsIntoMemoryAndCache([attempt]);
  notifyScoreUpdate();

  // 2. ASYNCHRONOUS BACKGROUND SYNC: Save to Supabase Storage, DB table, and Firestore without blocking UI
  (async () => {
    try {
      // 2a. Fetch existing student attempts to preserve attempt history and deduplicate
      let existingStudentAttempts = await fetchStudentTestAttemptsFromSupabase(studentId, attempt.studentName);

      const existingIndex = existingStudentAttempts.findIndex((a) => {
        const aTopicNorm = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
        const aTestType = a.testType || "topic";
        return (
          (a.classGrade || "").toLowerCase().trim() === (attempt.classGrade || "").toLowerCase().trim() &&
          (a.subject || "").toLowerCase().trim() === (attempt.subject || "").toLowerCase().trim() &&
          Number(a.chapterNo) === Number(attempt.chapterNo) &&
          aTopicNorm === topicNorm &&
          aTestType === testType
        );
      });

      let updatedAttempt = { ...attempt };

      if (existingIndex > -1) {
        const prev = existingStudentAttempts[existingIndex];
        updatedAttempt = {
          ...prev,
          ...attempt,
          id: prev.id || attempt.id,
          attemptNumber: Math.max(attempt.attemptNumber || 1, (prev.attemptNumber || 0) + 1),
          timestamp: attempt.timestamp || Date.now()
        };
        existingStudentAttempts[existingIndex] = updatedAttempt;
      } else {
        existingStudentAttempts.push(updatedAttempt);
      }

      const finalStudentAttempts = deduplicateAttempts(existingStudentAttempts);

      // 2b. Save per-student JSON file to Cloudflare R2
      try {
        const filePath = getStudentAttemptStoragePath(studentId);
        await uploadJsonToR2(filePath, finalStudentAttempts);
      } catch (err) {
        console.warn(`[ScorePersistence] Storage upload error for student ${studentId}:`, err);
      }

      // 2c. Update global test_attempts.json in Cloudflare R2
      try {
        const globalList = (await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json")) || [];
        const otherStudentsAttempts = globalList.filter((a) => {
          const aId = cleanId(a.studentId);
          const aName = cleanId(a.studentName);
          return aId !== cId && aName !== cleanId(attempt.studentName);
        });

        const mergedGlobal = deduplicateAttempts([...otherStudentsAttempts, ...finalStudentAttempts]);
        await uploadJsonToR2("practice_tests/test_attempts.json", mergedGlobal);
      } catch (err) {
        console.warn("[ScorePersistence] Global attempts upload error:", err);
      }

      // 2d. Try DB Table upsert if table exists
      try {
        await supabase.from("student_practice_test_attempts").upsert({
          id: updatedAttempt.id,
          student_id: studentId,
          student_name: attempt.studentName,
          test_id: attempt.testId,
          topic_id: attempt.topicId,
          chapter_id: attempt.chapterId,
          subject_id: attempt.subjectId,
          class_grade: attempt.classGrade,
          subject: attempt.subject,
          chapter_no: attempt.chapterNo,
          chapter_name: attempt.chapterName,
          topic_name: attempt.topicName,
          test_type: attempt.testType,
          attempt_number: updatedAttempt.attemptNumber,
          date: updatedAttempt.date,
          timestamp: updatedAttempt.timestamp,
          time_taken_seconds: updatedAttempt.timeTakenSeconds,
          score: updatedAttempt.score,
          total_marks: updatedAttempt.totalMarks || updatedAttempt.totalQuestions,
          total_questions: updatedAttempt.totalQuestions,
          percentage: updatedAttempt.percentage,
          correct_answers_count: updatedAttempt.correctAnswersCount,
          wrong_answers_count: updatedAttempt.wrongAnswersCount,
          user_answers: updatedAttempt.userAnswers
        });
      } catch (err) {
        // DB table might not exist
      }

      // 2e. Save to Firestore doc
      try {
        await saveTestAttemptDoc(updatedAttempt);
      } catch (err) {
        console.warn("[ScorePersistence] Firestore save error:", err);
      }

      // 2f. Synchronize in memory & session cache
      scoreSessionCache.set(cacheKey, updatedAttempt);
      mergeAttemptsIntoMemoryAndCache([updatedAttempt]);
    } catch (bgErr) {
      console.warn("[ScorePersistence] Background sync error:", bgErr);
    }
  })();

  return attempt;
}

/**
 * Merges new attempts into in-memory array and local storage cache
 */
export function mergeAttemptsIntoMemoryAndCache(newAttempts: TestAttemptRecord[]): void {
  const currentLocal = getLocalTestAttempts();
  const combined = deduplicateAttempts([...inMemoryAttempts, ...currentLocal, ...newAttempts]);
  inMemoryAttempts = combined;
  saveLocalTestAttemptsCache(combined);
}

/**
 * Dispatches window events to notify UI components to re-render with latest scores
 */
export function notifyScoreUpdate(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("test-attempts-updated"));
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }
}

/**
 * Synchronously retrieves cached attempts from memory and local storage
 */
export function getCachedAttemptsFromMemory(): TestAttemptRecord[] {
  const local = getLocalTestAttempts();
  return deduplicateAttempts([...inMemoryAttempts, ...local]);
}

/**
 * Legacy support helper: Load student test scores
 */
export async function loadStudentTestScores(studentId: string): Promise<TestAttemptRecord[]> {
  return fetchStudentTestAttemptsFromSupabase(studentId);
}

function findMatchingAttempt(
  attempts: TestAttemptRecord[],
  normStudent: string,
  normClass: string,
  normSubj: string,
  chapterNo?: number,
  normTopic?: string,
  testType: string = "topic"
): TestAttemptRecord | null {
  if (!attempts || attempts.length === 0) return null;

  const matches = attempts.filter((a) => {
    if (!a) return false;
    if (a.testType && a.testType !== testType) return false;
    const aStudent = cleanId(a.studentId) || cleanId(a.studentName);
    if (normStudent && aStudent !== normStudent && a.studentId !== normStudent) return false;
    if (normClass && (a.classGrade || "").toLowerCase().trim() !== normClass) return false;
    if (normSubj && (a.subject || "").toLowerCase().trim() !== normSubj) return false;
    if (chapterNo !== undefined && Number(a.chapterNo) !== Number(chapterNo)) return false;
    if (normTopic && testType === "topic") {
      const aTopicNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return aTopicNorm === normTopic || aTopicNorm.includes(normTopic) || normTopic.includes(aTopicNorm);
    }
    return true;
  });

  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return matches[0];
}

/**
 * Optimized simultaneous score fetcher.
 * Queries Supabase directly using indexed student_id and returns the specific saved attempt for a topic.
 * Uses session caching and promise deduplication to prevent redundant requests.
 */
export async function fetchStudentScore(
  studentId: string,
  classGradeOrTopicId?: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType: "topic" | "full_chapter" = "topic"
): Promise<TestAttemptRecord | null> {
  if (!studentId) return null;

  let classGrade = classGradeOrTopicId || "";
  if (classGradeOrTopicId && classGradeOrTopicId.includes("__") && !subject) {
    const parts = classGradeOrTopicId.split("__");
    classGrade = parts[0] || "";
    subject = parts[1] || "";
    chapterNo = parseInt((parts[2] || "").replace("ch", ""), 10) || 1;
    topicName = parts.slice(3).join("__");
  }

  const normStudent = cleanId(studentId);
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const cacheKey = `${normStudent}__${normClass}__${normSubj}__${chapterNo || 0}__${normTopic}__${testType}`;

  if (scoreSessionCache.has(cacheKey)) {
    return scoreSessionCache.get(cacheKey) || null;
  }

  if (inFlightScoreRequests.has(cacheKey)) {
    return inFlightScoreRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      // 1. Check in-memory attempts
      const cachedAttempts = getCachedAttemptsFromMemory();
      const existing = findMatchingAttempt(cachedAttempts, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
      if (existing) {
        scoreSessionCache.set(cacheKey, existing);
        return existing;
      }

      // 2. Perform targeted Supabase DB query with minimal required columns
      const { data, error } = await supabase
        .from("student_practice_test_attempts")
        .select("id, student_id, student_name, test_id, topic_id, chapter_id, subject_id, class_grade, subject, chapter_no, chapter_name, topic_name, test_type, attempt_number, date, timestamp, time_taken_seconds, score, total_marks, total_questions, percentage, correct_answers_count, wrong_answers_count, user_answers")
        .eq("student_id", studentId)
        .order("timestamp", { ascending: false })
        .limit(20);

      if (!error && Array.isArray(data) && data.length > 0) {
        const converted: TestAttemptRecord[] = data.map((row) => ({
          id: row.id || `att_${row.timestamp || Date.now()}`,
          studentId: row.student_id || studentId,
          studentName: row.student_name || "",
          testId: row.test_id,
          topicId: row.topic_id,
          chapterId: row.chapter_id,
          subjectId: row.subject_id,
          classGrade: row.class_grade || "",
          subject: row.subject || "",
          chapterNo: row.chapter_no || 0,
          chapterName: row.chapter_name || "",
          topicName: row.topic_name || "",
          testType: row.test_type || "topic",
          attemptNumber: row.attempt_number || 1,
          date: row.date || new Date().toISOString(),
          timestamp: row.timestamp || Date.now(),
          timeTakenSeconds: row.time_taken_seconds || 0,
          score: row.score || 0,
          totalMarks: row.total_marks || row.total_questions || 0,
          totalQuestions: row.total_questions || 0,
          percentage: row.percentage || 0,
          correctAnswersCount: row.correct_answers_count || 0,
          wrongAnswersCount: row.wrong_answers_count || 0,
          userAnswers: row.user_answers || {}
        }));

        mergeAttemptsIntoMemoryAndCache(converted);
        const match = findMatchingAttempt(converted, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
        if (match) {
          scoreSessionCache.set(cacheKey, match);
          return match;
        }
      }

      // 3. Fallback to per-student storage file if DB is empty
      const storageAttempts = await fetchStudentTestAttemptsFromSupabase(studentId);
      const storageMatch = findMatchingAttempt(storageAttempts, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
      if (storageMatch) {
        scoreSessionCache.set(cacheKey, storageMatch);
        return storageMatch;
      }
    } catch (e) {
      console.warn("[ScorePersistence] fetchStudentScore error:", e);
    } finally {
      inFlightScoreRequests.delete(cacheKey);
    }

    scoreSessionCache.set(cacheKey, null);
    return null;
  })();

  inFlightScoreRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Clear test score cache
 */
export function clearTestScoreCache(): void {
  inMemoryAttempts = [];
  scoreSessionCache.clear();
  inFlightScoreRequests.clear();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TEST_SCORE_CACHE_KEY);
    localStorage.removeItem("tuition_student_test_score_cache");
    localStorage.removeItem("tuition_test_attempts_cache");
  } catch (err) {
    console.warn("[TestScoreService] Error clearing test score cache:", err);
  }
}

/**
 * Permanently deletes ALL student practice test attempts, scores, and marks from Supabase DB,
 * Supabase Storage, and local/memory caches.
 */
export async function deleteAllAttemptsAndScoresFromPersistence(): Promise<{ success: boolean; deletedCount: number }> {
  console.log("[ScorePersistence] [START_DELETE_ALL] Initiating permanent deletion of ALL student practice test attempts and marks.");
  let deletedCount = 0;

  // 1. Delete all rows from Supabase DB table `student_practice_test_attempts`
  try {
    const { data: dbRows, error: selectErr } = await supabase
      .from("student_practice_test_attempts")
      .select("id")
      .range(0, 9999);

    if (!selectErr && Array.isArray(dbRows) && dbRows.length > 0) {
      const ids = dbRows.map((r) => r.id);
      deletedCount = ids.length;
      console.log(`[ScorePersistence] Deleting ${ids.length} student attempt records from Supabase DB...`);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        await supabase.from("student_practice_test_attempts").delete().in("id", chunk);
      }
    }

    // Direct wipe queries
    await supabase.from("student_practice_test_attempts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("student_practice_test_attempts").delete().gte("timestamp", 0);
  } catch (err) {
    console.warn("[ScorePersistence] Error deleting all attempts from Supabase DB:", err);
  }

  // 2. Clear Cloudflare R2 `practice_tests/test_attempts.json` and student attempt files
  try {
    await uploadJsonToR2("practice_tests/test_attempts.json", []);

    // List and delete individual student attempt files
    const fileList = await listFromR2({ bucket: PRACTICE_TESTS_BUCKET, prefix: "practice_tests/student_attempts" });

    if (Array.isArray(fileList) && fileList.length > 0) {
      const pathsToDelete = fileList.map((f) => f.key);
      await deleteMultipleFromR2({ bucket: PRACTICE_TESTS_BUCKET, keys: pathsToDelete });
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error wiping storage attempts:", err);
  }

  // 3. Clear in-memory and local storage caches
  inMemoryAttempts = [];
  scoreSessionCache.clear();
  inFlightScoreRequests.clear();
  saveLocalTestAttemptsCache([]);
  clearTestScoreCache();

  return { success: true, deletedCount };
}

/**
 * Permanently deletes all student attempts and scores for a specific topic from Supabase DB,
 * Supabase Storage, Firestore, memory cache, and local storage.
 */
export async function deleteTopicAttemptsFromPersistence(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ success: boolean; deletedCount: number }> {
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim();
  const normTopicClean = normTopic.replace(/[^a-z0-9]/g, "");

  console.log(`[ScorePersistence] Deleting all student attempts for topic: [${classGrade}] ${subject} Ch${chapterNo}: ${topicName}`);

  let deletedCount = 0;

  // 1. Delete matching rows from Supabase DB table `student_practice_test_attempts`
  try {
    const { data: dbRows, error: selectErr } = await supabase
      .from("student_practice_test_attempts")
      .select("id, class_grade, subject, chapter_no, topic_name")
      .range(0, 9999);

    if (!selectErr && Array.isArray(dbRows)) {
      const idsToDelete = dbRows
        .filter((row) => {
          const rClass = (row.class_grade || "").toLowerCase().trim();
          const rSubj = (row.subject || "").toLowerCase().trim();
          const rTopic = (row.topic_name || "").toLowerCase().trim();
          const rTopicClean = rTopic.replace(/[^a-z0-9]/g, "");
          const isChapterMatch = Number(row.chapter_no) === Number(chapterNo);
          return (
            (rClass === normClass && rSubj === normSubj && isChapterMatch && (rTopic === normTopic || rTopicClean === normTopicClean)) ||
            (isChapterMatch && rTopicClean === normTopicClean)
          );
        })
        .map((r) => r.id);

      if (idsToDelete.length > 0) {
        console.log(`[ScorePersistence] Deleting ${idsToDelete.length} attempts from Supabase DB...`);
        for (let i = 0; i < idsToDelete.length; i += 100) {
          const chunk = idsToDelete.slice(i, i + 100);
          await supabase.from("student_practice_test_attempts").delete().in("id", chunk);
        }
        deletedCount += idsToDelete.length;
      }
    }

    // Direct deletion fallback
    await supabase.from("student_practice_test_attempts").delete().match({
      class_grade: classGrade,
      subject: subject,
      chapter_no: chapterNo,
      topic_name: topicName
    });
    await supabase.from("student_practice_test_attempts").delete().eq("topic_name", topicName);
  } catch (err) {
    console.warn("[ScorePersistence] Error deleting attempts from Supabase DB:", err);
  }

  // 2. Delete/filter matching attempts in Cloudflare R2 `practice_tests/test_attempts.json`
  try {
    const parsed = await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json");
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((a) => {
        const aClass = (a.classGrade || "").toLowerCase().trim();
        const aSubj = (a.subject || "").toLowerCase().trim();
        const aTopic = (a.topicName || "").toLowerCase().trim();
        const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
        const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

        const isMatch =
          (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
          (isChapterMatch && aTopicClean === normTopicClean);
        return !isMatch;
      });

      await uploadJsonToR2("practice_tests/test_attempts.json", filtered);
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error updating global test_attempts.json in Storage:", err);
  }

  // 3. Clear from in-memory attempts and session cache
  inMemoryAttempts = inMemoryAttempts.filter((a) => {
    const aClass = (a.classGrade || "").toLowerCase().trim();
    const aSubj = (a.subject || "").toLowerCase().trim();
    const aTopic = (a.topicName || "").toLowerCase().trim();
    const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
    const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

    const isMatch =
      (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
      (isChapterMatch && aTopicClean === normTopicClean);
    return !isMatch;
  });

  scoreSessionCache.clear();
  inFlightScoreRequests.clear();

  // 4. Update local storage cache
  const localAttempts = getLocalTestAttempts().filter((a) => {
    const aClass = (a.classGrade || "").toLowerCase().trim();
    const aSubj = (a.subject || "").toLowerCase().trim();
    const aTopic = (a.topicName || "").toLowerCase().trim();
    const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
    const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

    const isMatch =
      (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
      (isChapterMatch && aTopicClean === normTopicClean);
    return !isMatch;
  });
  saveLocalTestAttemptsCache(localAttempts);

  try {
    localStorage.removeItem(TEST_SCORE_CACHE_KEY);
  } catch (e) {}

  notifyScoreUpdate();

  return { success: true, deletedCount };
}

/**
 * Get a specific topic's high score percentage for a student
 */
export function getStudentTopicHighScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): number | null {
  const attempts = getCachedAttemptsFromMemory();

  const topicAttempts = attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  });

  if (topicAttempts.length === 0) return null;

  let highestScore = 0;
  topicAttempts.forEach((a) => {
    const pct = a.percentage ?? (a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0);
    if (pct > highestScore) highestScore = pct;
  });

  return highestScore;
}

/**
 * Get total attempt count for a topic
 */
export function getStudentTopicAttemptCount(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): number {
  const attempts = getCachedAttemptsFromMemory();

  return attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  }).length;
}

/**
 * Get latest attempt for a topic
 */
export function getStudentTopicLatestScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): TestAttemptRecord | null {
  const attempts = getCachedAttemptsFromMemory();

  const topicAttempts = attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  });

  if (topicAttempts.length === 0) return null;

  topicAttempts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return topicAttempts[0];
}

/**
 * Subscribe to student test scores
 */
export function subscribeToStudentTestScores(
  studentId: string,
  onUpdate: (scores: TestAttemptRecord[]) => void,
  onError?: (err: any) => void
): () => void {
  return subscribeToTestAttempts(
    (allAttempts) => {
      const studentScores = allAttempts.filter((a) => cleanId(a.studentId) === cleanId(studentId));
      onUpdate(studentScores);
    },
    onError
  );
}

export default {
  fetchStudentTestAttemptsFromSupabase,
  savePracticeTestAttemptToSupabase,
  getCachedAttemptsFromMemory,
  deduplicateAttempts,
  loadStudentTestScores,
  clearTestScoreCache,
  getStudentTopicHighScore,
  getStudentTopicAttemptCount,
  getStudentTopicLatestScore,
  subscribeToStudentTestScores
};
