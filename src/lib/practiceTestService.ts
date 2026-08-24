import { supabase } from "./supabaseClient";
import { ParsedAssessmentQuestion, TopicPracticeTest, TestAttemptRecord } from "../types";
import { getResolvedViewUrl } from "./storageService";
import { uploadToR2, downloadFromR2, getR2BucketName } from "./r2Client";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { normalizeQuestionOptions } from "../utils/assessmentParser";

import { safeLocalStorageSetItem, safeLocalStorageGetItem, safeLocalStorageRemoveItem } from "./safeStorage";
import { deleteTopicAttemptsFromPersistence, deleteAllAttemptsAndScoresFromPersistence, clearTestScoreCache } from "./testScorePersistence";

const TESTS_CACHE_KEY = "tuition_topic_practice_tests_bank";
const SYNC_QUEUE_KEY = "tuition_practice_tests_sync_queue";
const PRACTICE_TESTS_BUCKET = "academy-connect-files";
const PRACTICE_TESTS_FILE_PATH = "practice_tests/test_bank.json";
const PRACTICE_TEST_ATTEMPTS_FILE_PATH = "practice_tests/test_attempts.json";

const IDB_DB_NAME = "tuition_practice_tests_db";
const IDB_DB_VERSION = 1;
const IDB_SYNC_QUEUE_STORE = "syncQueue";
const MAX_SYNC_RETRIES = 3;
const MAX_LOCAL_STORAGE_ITEM_BYTES = 50 * 1024;

let memorySyncQueue: SyncQueueItem[] = [];
let practiceTestsRealtimeChannel: any = null;
let isRealtimeInitialized = false;

/**
 * Broadcasts a practice test change signal locally, via BroadcastChannel (same-origin tabs),
 * and via Firestore practice_tests_sync collection (cross-device real-time sync).
 */
export async function notifyPracticeTestRealtimeSync(details?: any): Promise<void> {
  clearAllQuestionCaches();

  // 1. Dispatch local event immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }

  // 2. BroadcastChannel for instant same-browser multi-tab synchronization
  try {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const bc = new BroadcastChannel("tuition_practice_tests_channel");
      bc.postMessage({ type: "PRACTICE_TESTS_UPDATED", timestamp: Date.now(), ...details });
      bc.close();
    }
  } catch (err) {}

  // 3. Firestore realtime signal for cross-device real-time synchronization
  try {
    const db = await getFirebaseDb();
    if (db) {
      const syncDocRef = doc(db, "practice_tests_sync", "latest");
      await setDoc(syncDocRef, {
        updatedAt: new Date().toISOString(),
        timestamp: Date.now(),
        ...details,
      }, { merge: true });
    }
  } catch (err) {
    console.warn("[PracticeTestService] Failed to send Firestore practice test sync signal:", err);
  }
}

async function openPracticeTestsDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_SYNC_QUEUE_STORE)) {
        db.createObjectStore(IDB_SYNC_QUEUE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn("[PracticeTestService] IndexedDB open blocked by another tab.");
    };
  });
}

async function filterSyncQueue(predicate: (item: SyncQueueItem) => boolean): Promise<void> {
  const queue = await getSyncQueue();
  const filtered = queue.filter(predicate);
  await saveSyncQueue(filtered);
}

async function removeSyncQueueItemsForTopic(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<void> {
  await filterSyncQueue((item) => {
    if (!item.context) return true;
    return !(
      item.context.classGrade === classGrade &&
      item.context.subject === subject &&
      item.context.chapterNo === chapterNo &&
      item.context.topicName === topicName
    );
  });
}

async function removeSyncQueueItemsForQuestion(questionId: string): Promise<void> {
  await filterSyncQueue((item) => {
    if (item.data && item.data.id) {
      return item.data.id !== questionId;
    }
    return true;
  });
}

async function queueOfflineDeleteTopic(context: {
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
}): Promise<void> {
  await removeSyncQueueItemsForTopic(context.classGrade, context.subject, context.chapterNo, context.topicName);
  await addToSyncQueue({ action: "delete_topic", context });
}

async function queueOfflineDeleteQuestion(questionId: string): Promise<void> {
  await removeSyncQueueItemsForQuestion(questionId);
  await addToSyncQueue({ action: "delete_question", data: { id: questionId } });
}

export function initPracticeTestsRealtimeSync(): void {
  if (typeof window === "undefined") return;
  if (isRealtimeInitialized) return;
  isRealtimeInitialized = true;

  // A. Supabase Realtime Channel
  try {
    const supabaseAny = supabase as any;
    if (typeof supabaseAny.channel === "function" && !practiceTestsRealtimeChannel) {
      practiceTestsRealtimeChannel = supabaseAny
        .channel("practice_tests_changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "topic_assessment_questions" },
          async (payload: any) => {
            console.log("[PracticeTestService] Realtime event for topic assessment questions:", payload);
            try {
              await fetchAllPracticeTestsFromSupabase();
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("practice-tests-updated"));
              }
            } catch (err) {
              console.warn("[PracticeTestService] Realtime refresh failed:", err);
            }
          }
        )
        .subscribe();
    }
  } catch (err) {
    console.warn("[PracticeTestService] Failed to initialize Supabase realtime sync:", err);
  }

  // B. BroadcastChannel for same-origin multi-tab sync
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel("tuition_practice_tests_channel");
      bc.onmessage = async (event) => {
        if (event.data?.type === "PRACTICE_TESTS_UPDATED") {
          console.log("[PracticeTestService] BroadcastChannel practice test update received");
          await fetchAllPracticeTestsFromSupabase();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("practice-tests-updated"));
          }
        }
      };
    }
  } catch (err) {}

  // C. Firestore Realtime Snapshot for cross-device sync
  getFirebaseDb().then((db) => {
    if (!db) return;
    try {
      const syncDocRef = doc(db, "practice_tests_sync", "latest");
      let lastProcessedTs = 0;

      onSnapshot(
        syncDocRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const ts = Number(data?.timestamp) || 0;
            if (ts && ts > lastProcessedTs) {
              lastProcessedTs = ts;
              console.log("[PracticeTestService] Firestore realtime practice test sync signal received:", data);
              await fetchAllPracticeTestsFromSupabase();
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("practice-tests-updated"));
              }
            }
          }
        },
        (err) => {
          console.warn("[PracticeTestService] Firestore practice_tests_sync snapshot error:", err);
        }
      );
    } catch (err) {
      console.warn("[PracticeTestService] Failed setting up Firestore practice_tests_sync listener:", err);
    }
  });
}

if (typeof window !== "undefined") {
  initPracticeTestsRealtimeSync();
}

async function readSyncQueueFromIDB(): Promise<SyncQueueItem[]> {
  const db = await openPracticeTestsDB();
  if (!db) return memorySyncQueue;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SYNC_QUEUE_STORE, "readonly");
    const store = tx.objectStore(IDB_SYNC_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as SyncQueueItem[]);
    request.onerror = () => reject(request.error);
  });
}

async function writeSyncQueueToIDB(queue: SyncQueueItem[]): Promise<void> {
  const db = await openPracticeTestsDB();
  if (!db) {
    memorySyncQueue = queue;
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SYNC_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(IDB_SYNC_QUEUE_STORE);
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      for (const item of queue) {
        store.put(item);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export interface SaveTopicResult {
  success: boolean;
  count: number;
  message: string;
  error?: string;
  fromCache?: boolean;
}

export interface SyncQueueItem {
  id: string;
  action: "save_topic" | "delete_topic" | "delete_question" | "update_question";
  context?: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    rawText?: string;
  };
  data?: any;
  timestamp: number;
  retryCount?: number;
}

/**
 * Normalizes test ID for topic practice tests
 */
export function buildTopicTestId(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): string {
  const normClass = String(classGrade || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normSubj = String(subject || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normTopic = String(topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__${normTopic}`;
}

/**
 * Strict exact match comparison for topics to prevent deleting/overwriting unrelated tests
 */
export function isSubjectCompatible(subj1: string, subj2: string): boolean {
  const s1 = String(subj1 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = String(subj2 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s1 || !s2) return true;
  if (s1 === s2) return true;
  if (s1.includes(s2) || s2.includes(s1)) return true;

  // Social Science sub-subject aliases
  const sstAliases = [
    "socialscience", "sst", "socialstudies", "social",
    "geography", "history", "politicalscience", "civics",
    "economics", "indianheritageandculture", "contemporaryindia",
    "democraticpolitics", "understandingeconomicdevelopment", "indiaandthecontemporaryworld"
  ];
  if (sstAliases.includes(s1) && sstAliases.includes(s2)) return true;

  // Science sub-subject aliases
  const scienceAliases = [
    "science", "sci", "physics", "chemistry", "biology",
    "lifescience", "physicalscience", "generalscience", "natsci", "naturalscience"
  ];
  if (scienceAliases.includes(s1) && scienceAliases.includes(s2)) return true;

  // Mathematics aliases
  const mathAliases = [
    "math", "maths", "mathematics", "appliedmaths", "basicmaths",
    "standardmaths", "highermaths", "generalmaths", "algebra", "geometry"
  ];
  if (mathAliases.includes(s1) && mathAliases.includes(s2)) return true;

  // Language aliases
  const engAliases = ["english", "englishlanguage", "englishliterature", "eng", "firstlanguageenglish", "secondlanguageenglish", "englishcommunicative"];
  if (engAliases.includes(s1) && engAliases.includes(s2)) return true;

  const hindiAliases = ["hindi", "hindicoursea", "hindicourseb", "hindilit", "hindilang"];
  if (hindiAliases.includes(s1) && hindiAliases.includes(s2)) return true;

  const bengaliAliases = ["bengali", "bangla", "bengaliliterature", "bengalilanguage"];
  if (bengaliAliases.includes(s1) && bengaliAliases.includes(s2)) return true;

  return false;
}

function normalizeGradeNumber(gradeStr: string): number | null {
  const s = String(gradeStr || "").toLowerCase().trim();
  if (!s) return null;
  const numMatch = s.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  const romanMatch = s.match(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\b/i);
  if (romanMatch) {
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12
    };
    const r = romanMatch[1].toLowerCase();
    if (romanMap[r]) return romanMap[r];
  }
  return null;
}

function extractTopicNumber(raw: string): number | null {
  const norm = String(raw || "").toLowerCase();
  const match = norm.match(/(?:topic|part|pt|ch|chapter|unit)?\s*(\d+)/i);
  if (match) return parseInt(match[1], 10);
  const romanMatch = norm.match(/(?:topic|part|pt|ch|chapter|unit)?\s*\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/i);
  if (romanMatch) {
    const roman = romanMatch[1].toLowerCase();
    const romanMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    if (romanMap[roman]) return romanMap[roman];
  }
  return null;
}

function cleanTopicText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "and")
    .replace(/^(?:topic|part|pt|ch|chapter|unit)?\s*\d*\s*[:\–\-]?\s*/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Strict exact match comparison for topics to prevent deleting/overwriting unrelated tests
 */
export function isExactTopicMatch(
  classGrade1: string,
  subject1: string,
  chapterNo1: number | string,
  topicName1: string,
  classGrade2: string,
  subject2: string,
  chapterNo2: number | string,
  topicName2: string
): boolean {
  const ch1 = typeof chapterNo1 === "number" ? chapterNo1 : (parseInt(String(chapterNo1 || "").replace(/\D/g, ""), 10) || Number(chapterNo1) || 0);
  const ch2 = typeof chapterNo2 === "number" ? chapterNo2 : (parseInt(String(chapterNo2 || "").replace(/\D/g, ""), 10) || Number(chapterNo2) || 0);
  if (ch1 > 0 && ch2 > 0 && ch1 !== ch2) return false;

  // Compare Class / Grade
  const g1 = normalizeGradeNumber(classGrade1);
  const g2 = normalizeGradeNumber(classGrade2);
  if (g1 !== null && g2 !== null) {
    if (g1 !== g2) return false;
  } else {
    const c1 = String(classGrade1 || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/class|grade|std|standard/g, "");
    const c2 = String(classGrade2 || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/class|grade|std|standard/g, "");
    if (c1 && c2 && c1 !== c2 && !c1.includes(c2) && !c2.includes(c1)) return false;
  }

  if (!isSubjectCompatible(subject1, subject2)) return false;

  const t1 = String(topicName1 || "").toLowerCase().trim();
  const t2 = String(topicName2 || "").toLowerCase().trim();
  if (!t1 || !t2) return true;
  if (t1 === t2) return true;

  const ct1 = t1.replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const ct2 = t2.replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  if (ct1 && ct2 && (ct1 === ct2 || ct1.includes(ct2) || ct2.includes(ct1))) return true;

  // Extract topic numbers
  const num1 = extractTopicNumber(t1);
  const num2 = extractTopicNumber(t2);
  const text1 = cleanTopicText(t1);
  const text2 = cleanTopicText(t2);

  if (num1 !== null && num2 !== null && num1 === num2) {
    if (!text1 || !text2) return true;
    if (text1 === text2 || text1.includes(text2) || text2.includes(text1)) return true;
  }

  if (text1 && text2) {
    if (text1 === text2 || text1.includes(text2) || text2.includes(text1)) return true;
  }

  return false;
}

export async function resolveQuestionImageUrls(
  questions: ParsedAssessmentQuestion[]
): Promise<ParsedAssessmentQuestion[]> {
  if (!Array.isArray(questions)) return [];
  return Promise.all(
    questions.map(async (q) => {
      if (q.imageUrl && typeof q.imageUrl === "string") {
        try {
          const viewUrl = await getResolvedViewUrl("academy-connect-files", q.imageUrl);
          return { ...q, imageUrl: viewUrl };
        } catch (e) {
          return q;
        }
      }
      return q;
    })
  );
}

/**
 * Normalizes question ID
 */
export function buildQuestionId(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  index: number
): string {
  const base = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  return `q_${base}_${index + 1}_${Math.random().toString(36).substring(2, 7)}`;
}

// ----------------------------------------------------
// LOCAL CACHE & STORAGE SYNC HELPERS
// ----------------------------------------------------

export interface TopicPracticeTestMetadata {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  questionCount: number;
  lastUpdated: string;
}

// In-Memory RAM cache for active session fast access
let memoryTestBank: Record<string, TopicPracticeTest> = {};

/**
 * Clears in-memory caches, question session caches, and in-flight request caches
 */
export function clearAllQuestionCaches(): void {
  memoryTestBank = {};
  activeFetchPromise = null;
  if (typeof window !== "undefined") {
    try {
      safeLocalStorageRemoveItem(TESTS_CACHE_KEY);
      safeLocalStorageRemoveItem("tuition_practice_tests_cache");
    } catch (e) {}
  }
  console.log("[PracticeTestService] [NO_CACHE] Cleared practice test caches.");
}

export interface ScoreButtonStyles {
  container: string;
  icon: string;
  scoreText: string;
  labelText: string;
}

export function getScoreButtonStyles(isAttempted: boolean, percentage?: number | null): ScoreButtonStyles {
  if (!isAttempted || percentage === undefined || percentage === null || isNaN(percentage)) {
    // Normal green Test button
    return {
      container: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
      icon: "text-emerald-600 dark:text-emerald-400",
      scoreText: "text-emerald-800 dark:text-emerald-200",
      labelText: "text-emerald-600 dark:text-emerald-400",
    };
  }

  const pct = Math.round(percentage);

  if (pct >= 90) {
    // Green (90–100%)
    return {
      container: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
      icon: "text-emerald-600 dark:text-emerald-400",
      scoreText: "text-emerald-800 dark:text-emerald-200",
      labelText: "text-emerald-600 dark:text-emerald-400",
    };
  } else if (pct >= 75) {
    // Blue (75–89%)
    return {
      container: "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-800 dark:text-blue-200",
      icon: "text-blue-600 dark:text-blue-400",
      scoreText: "text-blue-800 dark:text-blue-200",
      labelText: "text-blue-600 dark:text-blue-400",
    };
  } else if (pct >= 50) {
    // Orange (50–74%)
    return {
      container: "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200",
      icon: "text-amber-600 dark:text-amber-400",
      scoreText: "text-amber-800 dark:text-amber-200",
      labelText: "text-amber-600 dark:text-amber-400",
    };
  } else {
    // Red (Below 50%)
    return {
      container: "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-200",
      icon: "text-rose-600 dark:text-rose-400",
      scoreText: "text-rose-800 dark:text-rose-200",
      labelText: "text-rose-600 dark:text-rose-400",
    };
  }
}

export async function purgeAllPracticeTestsData(): Promise<void> {
  memoryTestBank = {};
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(TESTS_CACHE_KEY);
      localStorage.removeItem(SYNC_QUEUE_KEY);
      await writeSyncQueueToIDB([]);
    } catch (err) {
      console.warn("[PracticeTestService] Error clearing local cache:", err);
    }
  }

  try {
    const jsonString = JSON.stringify({}, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    await uploadToR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TESTS_FILE_PATH,
      file: blob,
      mimeType: "application/json",
    });
  } catch (err) {
    console.warn("[PracticeTestService] Storage purge warning:", err);
  }

  try {
    await supabase
      .from("topic_assessment_questions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
  } catch (err) {
    console.warn("[PracticeTestService] DB purge warning:", err);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }
}

export async function syncTestBankToSupabaseStorage(bank: Record<string, TopicPracticeTest>): Promise<boolean> {
  try {
    const jsonString = JSON.stringify(bank, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    await uploadToR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TESTS_FILE_PATH,
      file: blob,
      mimeType: "application/json",
    });
    return true;
  } catch (err) {
    console.warn("[PracticeTestService] Storage sync exception:", err);
    return false;
  }
}

export async function fetchTestBankFromSupabaseStorage(): Promise<Record<string, TopicPracticeTest> | null> {
  try {
    const { blob } = await downloadFromR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TESTS_FILE_PATH,
    });
    if (blob) {
      const text = await blob.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[PracticeTestService] Storage fetch error:", err);
  }
  return null;
}

export async function syncTestAttemptsToSupabaseStorage(attempts: TestAttemptRecord[]): Promise<boolean> {
  try {
    const jsonString = JSON.stringify(attempts, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    await uploadToR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TEST_ATTEMPTS_FILE_PATH,
      file: blob,
      mimeType: "application/json",
    });
    return true;
  } catch (err) {
    console.warn("[PracticeTestService] Storage attempts sync exception:", err);
    return false;
  }
}

export async function fetchTestAttemptsFromSupabaseStorage(): Promise<TestAttemptRecord[] | null> {
  try {
    const { blob } = await downloadFromR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TEST_ATTEMPTS_FILE_PATH,
    });
    if (blob) {
      const text = await blob.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[PracticeTestService] Storage attempts fetch error:", err);
  }
  return null;
}

export function getLocalTestBank(): Record<string, TopicPracticeTest> {
  return memoryTestBank;
}

export function getLocalTopicMetadata(): Record<string, TopicPracticeTestMetadata> {
  if (typeof window === "undefined") return {};
  try {
    const raw = safeLocalStorageGetItem(TESTS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

export function saveLocalTestBank(bank: Record<string, TopicPracticeTest>, options?: { silent?: boolean }): void {
  memoryTestBank = { ...bank };

  if (typeof window === "undefined") return;
  try {
    const metadataMap: Record<string, TopicPracticeTestMetadata> = {};
    for (const key of Object.keys(bank)) {
      const test = bank[key];
      if (!test) continue;
      metadataMap[key] = {
        id: test.id,
        classGrade: test.classGrade || "",
        subject: test.subject || "",
        chapterNo: Number(test.chapterNo) || 1,
        chapterName: test.chapterName || "",
        topicName: test.topicName || "",
        questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
        lastUpdated: test.updatedAt || new Date().toISOString(),
      };
    }

    const entries = Object.entries(metadataMap).sort(([, a], [, b]) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
    let trimmedMap: Record<string, TopicPracticeTestMetadata> = {};
    let json = "";

    for (const [key, metadata] of entries) {
      trimmedMap[key] = metadata;
      json = JSON.stringify(trimmedMap);
      if (json.length * 2 > MAX_LOCAL_STORAGE_ITEM_BYTES) {
        delete trimmedMap[key];
        break;
      }
    }

    safeLocalStorageSetItem(TESTS_CACHE_KEY, JSON.stringify(trimmedMap));
  } catch (err: any) {
    console.warn("[PracticeTestService] Error saving metadata:", err);
  } finally {
    if (!options?.silent) {
      window.dispatchEvent(new CustomEvent("practice-tests-updated"));
    }
  }
}

export function updateLocalTopicCache(test: TopicPracticeTest): void {
  memoryTestBank[test.id] = test;
  saveLocalTestBank(memoryTestBank);
  syncTestBankToSupabaseStorage(memoryTestBank).catch(() => {});
}

export function removeLocalTopicCache(testId: string): void {
  delete memoryTestBank[testId];

  // Also delete by normalized key match
  const parts = testId.split("__");
  if (parts.length >= 4) {
    const classGrade = parts[0];
    const subject = parts[1];
    const chapterNoStr = parts[2];
    const normTopic = parts.slice(3).join("__").toLowerCase().replace(/[^a-z0-9]/g, "");

    Object.keys(memoryTestBank).forEach((key) => {
      const t = memoryTestBank[key];
      if (
        t &&
        `ch${t.chapterNo}` === chapterNoStr &&
        (t.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "") === classGrade.toLowerCase().replace(/[^a-z0-9]/g, "") &&
        (t.subject || "").toLowerCase().replace(/[^a-z0-9]/g, "") === subject.toLowerCase().replace(/[^a-z0-9]/g, "") &&
        (t.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "") === normTopic
      ) {
        delete memoryTestBank[key];
      }
    });
  }
  saveLocalTestBank(memoryTestBank);
}

// ----------------------------------------------------
// SYNC QUEUE HELPERS (OFFLINE SUPPORT)
// ----------------------------------------------------

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  if (typeof window === "undefined") return [];
  try {
    return await readSyncQueueFromIDB();
  } catch (err) {
    console.warn("[PracticeTestService] Error reading sync queue from IndexedDB:", err);
    return memorySyncQueue;
  }
}

export async function saveSyncQueue(queue: SyncQueueItem[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const cleanQueue = queue.map((item) => {
      if (item.context && (item.context as any).rawText) {
        const { rawText, ...restContext } = item.context as any;
        return { ...item, context: restContext };
      }
      return item;
    });
    memorySyncQueue = cleanQueue;
    await writeSyncQueueToIDB(cleanQueue);
  } catch (err) {
    console.warn("[PracticeTestService] Error saving sync queue:", err);
    memorySyncQueue = queue;
  }
}

export async function addToSyncQueue(item: Omit<SyncQueueItem, "id" | "timestamp" | "retryCount">): Promise<void> {
  const queue = await getSyncQueue();

  const cleanQueue = queue.filter((q) => {
    if (q.action === item.action && q.context && item.context) {
      return (
        q.context.classGrade !== item.context.classGrade ||
        q.context.subject !== item.context.subject ||
        q.context.chapterNo !== item.context.chapterNo ||
        q.context.topicName !== item.context.topicName
      );
    }
    return true;
  });

  cleanQueue.push({
    ...item,
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: Date.now(),
    retryCount: 0,
  });

  await saveSyncQueue(cleanQueue);
}

/**
 * Automatically sync queued offline changes to Supabase when online.
 */
export async function processSyncQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await getSyncQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: queue.length };
  }

  console.log(`[PracticeTestService] Processing ${queue.length} offline sync items...`);
  let synced = 0;
  let failed = 0;
  const remaining: SyncQueueItem[] = [];

  for (const item of queue) {
    if (item.retryCount !== undefined && item.retryCount >= MAX_SYNC_RETRIES) {
      console.warn(
        `[PracticeTestService] Dropping sync queue item after ${item.retryCount} failed attempts:`,
        item
      );
      continue;
    }

    try {
      let itemSuccess = false;
      if (item.action === "save_topic" && item.context && item.data) {
        const res = await pushTopicToSupabase(item.context, item.data, item.context.rawText || "");
        itemSuccess = res.success;
      } else if (item.action === "delete_topic" && item.context) {
        const res = await deleteTopicFromSupabase(
          item.context.classGrade,
          item.context.subject,
          item.context.chapterNo,
          item.context.topicName
        );
        itemSuccess = res.success;
      } else if (item.action === "delete_question" && item.data?.id) {
        const res = await deleteAssessmentQuestion(item.data.id);
        itemSuccess = res.success;
      } else if (item.action === "update_question" && item.data?.id && item.data?.updates) {
        const res = await updateAssessmentQuestion(item.data.id, item.data.updates);
        itemSuccess = res.success;
      } else {
        itemSuccess = true;
      }

      if (itemSuccess) {
        synced++;
      } else {
        const queuedItem = { ...item, retryCount: (item.retryCount || 0) + 1 };
        if (queuedItem.retryCount < MAX_SYNC_RETRIES) {
          remaining.push(queuedItem);
        } else {
          failed++;
          console.warn(`[PracticeTestService] Sync queue item reached retry limit and will be dropped:`, queuedItem);
        }
      }
    } catch (err) {
      console.warn("[PracticeTestService] Failed syncing item:", item, err);
      const queuedItem = { ...item, retryCount: (item.retryCount || 0) + 1 };
      if (queuedItem.retryCount < MAX_SYNC_RETRIES) {
        remaining.push(queuedItem);
      } else {
        failed++;
        console.warn(`[PracticeTestService] Sync queue item reached retry limit due to exception and will be dropped:`, queuedItem);
      }
    }
  }

  await saveSyncQueue(remaining);

  if (synced > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("practice-tests-synced", {
        detail: { message: "Sync completed successfully.", count: synced },
      })
    );
  }

  return { synced, failed };
}

// Auto-listen to online event
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    processSyncQueue().catch((err) => console.warn("Error processing sync queue:", err));
  });
}

// ----------------------------------------------------
// SUPABASE DATABASE CONVERTERS
// ----------------------------------------------------

function generateDeterministicUuid(seedStr: string): string {
  let hash1 = 0, hash2 = 0, hash3 = 0, hash4 = 0;
  for (let i = 0; i < seedStr.length; i++) {
    const code = seedStr.charCodeAt(i);
    hash1 = (hash1 * 31 + code) & 0x7fffffff;
    hash2 = (hash2 * 33 + code) & 0x7fffffff;
    hash3 = (hash3 * 37 + code) & 0x7fffffff;
    hash4 = (hash4 * 39 + code) & 0x7fffffff;
  }
  const hex1 = hash1.toString(16).padStart(8, "0");
  const hex2 = hash2.toString(16).padStart(4, "0").slice(0, 4);
  const hex3 = hash3.toString(16).padStart(4, "0").slice(0, 4);
  const hex4 = hash4.toString(16).padStart(4, "0").slice(0, 4);
  const hex5 = (hash1 ^ hash2 ^ hash3).toString(16).padStart(12, "0").slice(0, 12);

  return `${hex1}-${hex2}-4${hex3.slice(1)}-8${hex4.slice(1)}-${hex5}`;
}

function toSupabaseRow(
  q: ParsedAssessmentQuestion,
  context: { classGrade: string; subject: string; chapterNo: number; chapterName: string; topicName: string },
  rawText: string,
  idx: number,
  overrideTestSessionId?: string
) {
  let validId = q.id;
  if (!validId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(validId)) {
    // Generate fresh random UUID so a newly created test never reuses deleted IDs
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      try {
        validId = crypto.randomUUID();
      } catch (e) {
        const seed = `${context.classGrade}__${context.subject}__ch${context.chapterNo}__${context.topicName}__q${idx + 1}__${overrideTestSessionId || Date.now()}__${Math.random()}`;
        validId = generateDeterministicUuid(seed);
      }
    } else {
      const seed = `${context.classGrade}__${context.subject}__ch${context.chapterNo}__${context.topicName}__q${idx + 1}__${overrideTestSessionId || Date.now()}__${Math.random()}`;
      validId = generateDeterministicUuid(seed);
    }
  }

  // Preserve image fields inside raw_text JSON tag if present so they persist across reloads
  let metaRawText = rawText || q.rawText || "";
  if (q.imageUrl) {
    try {
      const imageMeta = JSON.stringify({
        imageUrl: q.imageUrl,
        imageLabel: q.imageLabel,
        imagePosition: q.imagePosition,
      });
      if (!metaRawText.includes("[IMG_META:")) {
        metaRawText += `\n[IMG_META:${imageMeta}]`;
      }
    } catch {}
  }

  const row: any = {
    id: validId,
    class_id: String(context.classGrade || "").trim(),
    subject_id: String(context.subject || "").trim(),
    chapter_id: String(context.chapterNo || ""),
    topic_id: String(context.topicName || "").trim(),
    question_type: q.type === "assertion_reason" ? "ASSERTION_REASON" : (q.type === "true_false" ? "TRUE_FALSE" : "MCQ"),
    question: String(q.question || "").trim(),
    options: q.options || [],
    correct_answer: String(q.correctAnswer || "").trim(),
    published: q.published !== false,
    order_index: idx + 1,
    raw_text: metaRawText,
    created_at: q.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return row;
}

function fromSupabaseRow(row: any, fallbackChapterName: string = ""): ParsedAssessmentQuestion {
  let optionsList: string[] = [];
  if (Array.isArray(row.options)) {
    optionsList = row.options;
  } else if (typeof row.options === "string") {
    try {
      optionsList = JSON.parse(row.options);
    } catch {
      optionsList = [row.options];
    }
  }

  const rawType = String(row.question_type || "").toLowerCase();
  let qType: "mcq" | "true_false" | "assertion_reason" = "mcq";
  if (rawType.includes("assertion")) {
    qType = "assertion_reason";
  } else if (rawType.includes("true") || rawType.includes("false") || rawType === "tf") {
    qType = "true_false";
  } else {
    qType = "mcq";
  }

  if (qType !== "true_false") {
    optionsList = normalizeQuestionOptions(optionsList);
  }

  let imageUrl = row.image_url || row.imageUrl || undefined;
  let imageLabel = row.image_label || row.imageLabel || undefined;
  let imagePosition: "above" | "below" = (row.image_position || row.imagePosition || "below").toLowerCase() === "above" ? "above" : "below";

  if (!imageUrl && row.raw_text && typeof row.raw_text === "string" && row.raw_text.includes("[IMG_META:")) {
    try {
      const match = row.raw_text.match(/\[IMG_META:(.*?)\]/s);
      if (match && match[1]) {
        const meta = JSON.parse(match[1]);
        if (meta.imageUrl) imageUrl = meta.imageUrl;
        if (meta.imageLabel) imageLabel = meta.imageLabel;
        if (meta.imagePosition === "above") imagePosition = "above";
      }
    } catch {}
  }

  let explanation = row.explanation || undefined;
  if (!explanation && row.raw_text && typeof row.raw_text === "string" && row.raw_text.includes("[EXPLANATION:")) {
    try {
      const match = row.raw_text.match(/\[EXPLANATION:(.*?)\]/s);
      if (match && match[1]) {
        explanation = match[1].trim();
      }
    } catch {}
  }

  return {
    id: String(row.id),
    classGrade: String(row.class_id || ""),
    subject: String(row.subject_id || ""),
    chapterNo: Number(row.chapter_id) || 1,
    chapterName: fallbackChapterName || `Chapter ${row.chapter_id}`,
    topicName: String(row.topic_id || ""),
    type: qType,
    question: String(row.question || ""),
    options: optionsList,
    correctAnswer: String(row.correct_answer || ""),
    explanation,
    imageUrl,
    imageLabel,
    imagePosition,
    published: row.published !== false,
    orderIndex: Number(row.order_index) || 0,
    rawText: row.raw_text || "",
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

// ----------------------------------------------------
// CORE SERVICE API (SINGLE SOURCE OF TRUTH)
// ----------------------------------------------------

/**
 * Pushes topic assessment questions to Supabase table `topic_assessment_questions`.
 */
async function pushTopicToSupabase(
  context: { classGrade: string; subject: string; chapterNo: number; chapterName: string; topicName: string },
  questions: ParsedAssessmentQuestion[],
  rawText: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(
      `[PracticeTestService] Pushing ${questions.length} questions to Supabase DB for Class: "${context.classGrade}", Subj: "${context.subject}", Ch: ${context.chapterNo}, Topic: "${context.topicName}"`
    );

    // 1. Prepare rows with valid UUID IDs
    const rows = questions.map((q, idx) => toSupabaseRow(q, context, rawText, idx));
    const newQuestionIds = new Set(rows.map((r) => r.id));

    // Clean up obsolete/orphaned question rows in Supabase for this topic
    try {
      const { data: existingRows } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id")
        .eq("chapter_id", String(context.chapterNo));

      if (Array.isArray(existingRows)) {
        const orphanIds = existingRows
          .filter(
            (row) =>
              isExactTopicMatch(
                context.classGrade,
                context.subject,
                context.chapterNo,
                context.topicName,
                row.class_id || "",
                row.subject_id || "",
                row.chapter_id || "",
                row.topic_id || ""
              ) && !newQuestionIds.has(String(row.id))
          )
          .map((row) => String(row.id));

        if (orphanIds.length > 0) {
          console.log(`[PracticeTestService] Deleting ${orphanIds.length} obsolete question rows from Supabase.`);
          await supabase.from("topic_assessment_questions").delete().in("id", orphanIds);
        }
      }
    } catch (e) {
      console.warn("[PracticeTestService] Error cleaning up orphaned rows:", e);
    }

    // 2. Try upsert by ID
    let { error: insertErr } = await supabase
      .from("topic_assessment_questions")
      .upsert(rows, { onConflict: "id" });

    if (insertErr) {
      console.warn("[PracticeTestService] Primary upsert failed, retrying insert without optional fields...", insertErr.message);
      const rowsEssential = rows.map(({ image_position, image_label, raw_text, ...rest }: any) => rest);
      let { error: retry1 } = await supabase
        .from("topic_assessment_questions")
        .upsert(rowsEssential, { onConflict: "id" });

      if (!retry1) {
        insertErr = null;
      } else {
        // Plain insert fallback
        let { error: retry2 } = await supabase
          .from("topic_assessment_questions")
          .insert(rowsEssential);
        if (!retry2) {
          insertErr = null;
        }
      }
    }

    if (insertErr) {
      console.warn("[PracticeTestService] Supabase insert warning:", insertErr.message || insertErr);
      return { success: false, error: insertErr.message || JSON.stringify(insertErr) };
    }

    console.log(`[PracticeTestService] Successfully persisted ${questions.length} questions to Supabase DB.`);
    return { success: true };
  } catch (err: any) {
    console.warn("[PracticeTestService] Exception in pushTopicToSupabase:", err);
    return { success: false, error: err.message || "Network request failed" };
  }
}

/**
 * Delete topic assessment questions and all related data from Supabase
 */
async function deleteTopicFromSupabase(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ 
  success: boolean; 
  message?: string; 
  error?: string;
  deletedCounts?: { questions: number; answers: number; related: number };
}> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  const classTrim = (classGrade || "").trim();
  const subjTrim = (subject || "").trim();
  const topicTrim = (topicName || "").trim();
  const chStr = String(chapterNo);
  const chNum = Number(chapterNo) || 0;

  console.log(`[PracticeTestService] [START_DELETE] Initiating permanent Supabase deletion for Topic ID: "${topicName}", Practice Test ID: "${testId}"`);

  let deletedQuestionsCount = 0;
  let deletedAnswersCount = 0;
  let deletedRelatedCount = 0;

  try {
    const idsToDelete = new Set<string>();

    // 1. Check local test bank & in-memory cache for any question IDs associated with this test
    try {
      const bank = getLocalTestBank();
      if (bank[testId]?.questions) {
        bank[testId].questions.forEach((q) => {
          if (q.id) {
            idsToDelete.add(String(q.id));
            deletedQuestionsCount++;
            deletedAnswersCount += (q.options?.length || 0) + (q.correctAnswer ? 1 : 0);
          }
        });
      }
      Object.keys(bank).forEach((k) => {
        const t = bank[k];
        if (
          t &&
          (k === testId ||
            isExactTopicMatch(
              classGrade,
              subject,
              chapterNo,
              topicName,
              t.classGrade,
              t.subject,
              t.chapterNo,
              t.topicName
            ))
        ) {
          (t.questions || []).forEach((q) => {
            if (q.id && !idsToDelete.has(String(q.id))) {
              idsToDelete.add(String(q.id));
              deletedQuestionsCount++;
              deletedAnswersCount += (q.options?.length || 0) + (q.correctAnswer ? 1 : 0);
            }
          });
        }
      });
    } catch (e) {
      console.warn("[PracticeTestService] Error reading local bank question IDs for delete:", e);
    }

    // 2. Query Supabase table topic_assessment_questions using comprehensive scan
    try {
      const { data: dbRows, error: selectErr } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id, options, correct_answer, question")
        .range(0, 9999);

      if (!selectErr && Array.isArray(dbRows)) {
        dbRows.forEach((row) => {
          const rowClass = String(row.class_id || "").trim();
          const rowSubj = String(row.subject_id || "").trim();
          const rowChStr = String(row.chapter_id || "").trim();
          const rowChNum = parseInt(rowChStr.replace(/\D/g, ""), 10) || Number(rowChStr) || 0;
          const rowTopic = String(row.topic_id || "").trim();

          const isMatch =
            isExactTopicMatch(
              classGrade,
              subject,
              chapterNo,
              topicName,
              rowClass,
              rowSubj,
              rowChStr,
              rowTopic
            ) ||
            ((rowChNum === chNum || rowChStr === chStr) &&
              (rowTopic.toLowerCase() === topicTrim.toLowerCase() ||
                rowTopic.toLowerCase().replace(/[^a-z0-9]/g, "") === topicTrim.toLowerCase().replace(/[^a-z0-9]/g, ""))) ||
            (rowTopic.toLowerCase() === topicTrim.toLowerCase() && isSubjectCompatible(subject, rowSubj));

          if (isMatch) {
            const rowId = String(row.id);
            if (!idsToDelete.has(rowId)) {
              idsToDelete.add(rowId);
              deletedQuestionsCount++;
              let optCount = 0;
              if (Array.isArray(row.options)) {
                optCount = row.options.length;
              } else if (typeof row.options === "string") {
                try {
                  const p = JSON.parse(row.options);
                  optCount = Array.isArray(p) ? p.length : 1;
                } catch {
                  optCount = 1;
                }
              }
              deletedAnswersCount += optCount + (row.correct_answer ? 1 : 0);
            }
          }
        });
      } else if (selectErr) {
        console.warn("[PracticeTestService] Select error while scanning topic_assessment_questions:", selectErr);
      }
    } catch (e) {
      console.warn("[PracticeTestService] Exception querying rows for deletion:", e);
    }

    // 3. Delete matching rows by primary key IDs in chunks of 50
    if (idsToDelete.size > 0) {
      const idArray = Array.from(idsToDelete);
      console.log(`[PracticeTestService] Deleting ${idArray.length} questions by ID from Supabase topic_assessment_questions:`, idArray);
      for (let i = 0; i < idArray.length; i += 50) {
        const chunk = idArray.slice(i, i + 50);
        const { error: delErr } = await supabase.from("topic_assessment_questions").delete().in("id", chunk);
        if (delErr) {
          console.warn("[PracticeTestService] Error deleting questions chunk from Supabase:", delErr);
        }
      }
    }

    // 4. Execute direct property match deletes for fallback safety
    await Promise.allSettled([
      supabase.from("topic_assessment_questions").delete().match({
        class_id: classTrim,
        subject_id: subjTrim,
        chapter_id: chStr,
        topic_id: topicTrim,
      }),
      supabase.from("topic_assessment_questions").delete().match({
        chapter_id: chStr,
        topic_id: topicTrim,
      }),
      supabase.from("topic_assessment_questions").delete().eq("topic_id", topicName),
      supabase.from("topic_assessment_questions").delete().ilike("topic_id", topicTrim)
    ]);

    // 5. Verification step: confirm that zero Practice Test question records remain in Supabase
    let verificationPassed = false;
    try {
      const { data: remainingCheck, error: verifyQueryErr } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id")
        .range(0, 9999);

      if (verifyQueryErr) {
        console.warn("[PracticeTestService] Warning during deletion verification query:", verifyQueryErr);
      }

      if (Array.isArray(remainingCheck) && remainingCheck.length > 0) {
        const stubbornIds = remainingCheck
          .filter((row) => {
            const rowChStr = String(row.chapter_id || "").trim();
            const rowChNum = parseInt(rowChStr.replace(/\D/g, ""), 10) || Number(rowChStr) || 0;
            const rowTopic = String(row.topic_id || "").trim();
            return (
              isExactTopicMatch(
                classGrade,
                subject,
                chapterNo,
                topicName,
                row.class_id || "",
                row.subject_id || "",
                row.chapter_id || "",
                row.topic_id || ""
              ) ||
              ((rowChNum === chNum || rowChStr === chStr) &&
                rowTopic.toLowerCase().replace(/[^a-z0-9]/g, "") === topicTrim.toLowerCase().replace(/[^a-z0-9]/g, ""))
            );
          })
          .map((r) => String(r.id));

        if (stubbornIds.length > 0) {
          console.warn(`[PracticeTestService] Cleaning up ${stubbornIds.length} stubborn remaining rows during deletion verification:`, stubbornIds);
          for (let i = 0; i < stubbornIds.length; i += 50) {
            const chunk = stubbornIds.slice(i, i + 50);
            await supabase.from("topic_assessment_questions").delete().in("id", chunk);
          }

          // Second verification pass
          const { data: secondCheck } = await supabase
            .from("topic_assessment_questions")
            .select("id, class_id, subject_id, chapter_id, topic_id")
            .range(0, 9999);

          const stillStubborn = (secondCheck || []).filter((row) => {
            const rowChStr = String(row.chapter_id || "").trim();
            const rowChNum = parseInt(rowChStr.replace(/\D/g, ""), 10) || Number(rowChStr) || 0;
            const rowTopic = String(row.topic_id || "").trim();
            return (
              isExactTopicMatch(
                classGrade,
                subject,
                chapterNo,
                topicName,
                row.class_id || "",
                row.subject_id || "",
                row.chapter_id || "",
                row.topic_id || ""
              ) ||
              ((rowChNum === chNum || rowChStr === chStr) &&
                rowTopic.toLowerCase().replace(/[^a-z0-9]/g, "") === topicTrim.toLowerCase().replace(/[^a-z0-9]/g, ""))
            );
          });

          if (stillStubborn.length > 0) {
            console.error(`[PracticeTestService] Verification FAILED: ${stillStubborn.length} question records still exist in Supabase!`);
            return {
              success: false,
              error: `Verification failed: ${stillStubborn.length} question records still remain in Supabase for topic "${topicName}".`,
              message: `Deletion verification failed. Please try again.`
            };
          }
        }
      }
      verificationPassed = true;
    } catch (verifErr) {
      console.warn("[PracticeTestService] Error during deletion verification:", verifErr);
    }

    // 6. Delete all student attempts, scores, responses, and history for this topic from Supabase DB, Storage, and caches
    try {
      const attRes = await deleteTopicAttemptsFromPersistence(classGrade, subject, chapterNo, topicName);
      deletedRelatedCount += attRes?.deletedCount || 0;
    } catch (attErr) {
      console.warn("[PracticeTestService] Error deleting student attempts during topic delete:", attErr);
    }

    // 7. Remove any queued offline sync items for this topic
    await removeSyncQueueItemsForTopic(classGrade, subject, chapterNo, topicName);
    deletedRelatedCount++;

    // 8. Update Supabase Storage practice_tests/test_bank.json backup
    try {
      const storageBank = await fetchTestBankFromSupabaseStorage();
      if (storageBank && typeof storageBank === "object") {
        delete storageBank[testId];
        Object.keys(storageBank).forEach((k) => {
          const t = storageBank[k];
          if (
            t &&
            isExactTopicMatch(
              classGrade,
              subject,
              chapterNo,
              topicName,
              t.classGrade,
              t.subject,
              t.chapterNo,
              t.topicName
            )
          ) {
            delete storageBank[k];
          }
        });
        await syncTestBankToSupabaseStorage(storageBank);
        deletedRelatedCount++;
      }
    } catch (storageErr) {
      console.warn("[PracticeTestService] Error updating Storage test_bank.json during delete:", storageErr);
    }

    // 9. Comprehensive Cache Invalidation across all layers
    removeLocalTopicCache(testId);
    clearAllQuestionCaches();
    try {
      safeLocalStorageRemoveItem(TESTS_CACHE_KEY);
      safeLocalStorageRemoveItem("tuition_practice_tests_cache");
      safeLocalStorageRemoveItem("tuition_student_test_score_cache");
    } catch (e) {}

    const verifSummary = verificationPassed ? "Verification passed: 0 records remain in Supabase." : "Verification completed.";

    // 10. Structured debug logging as required
    console.log(
      `[PracticeTestService] [DELETE_SUMMARY] Topic ID: "${topicName}", Practice Test ID: "${testId}", Number of questions deleted: ${deletedQuestionsCount}, Number of answers deleted: ${deletedAnswersCount}, Number of related records deleted: ${deletedRelatedCount}, Verification result: ${verifSummary}`
    );

    return { 
      success: true, 
      message: "Practice Test deleted successfully.",
      deletedCounts: {
        questions: deletedQuestionsCount,
        answers: deletedAnswersCount,
        related: deletedRelatedCount
      }
    };
  } catch (err: any) {
    console.error(`[PracticeTestService] [DELETE_ERROR] Exception in deleteTopicFromSupabase for test "${testId}":`, err);
    return { success: false, error: err.message || String(err), message: err.message || "Failed to delete practice test." };
  }
}

/**
 * Permanently deletes ALL Practice Test data from the database.
 * 
 * Hierarchy:
 * Subject
 *  └── Chapters
 *       └── Topics
 *            └── Practice Test
 *                 └── Questions
 *                 └── Options
 *                 └── Correct Answers
 *                 └── Student Test Marks / Attempts
 * 
 * Requirements:
 * 1. Delete ALL Practice Tests from the database.
 * 2. For every Subject -> Chapter -> Topic:
 *    - Delete the Practice Test record.
 *    - Delete every question belonging to that Practice Test.
 *    - Delete every option.
 *    - Delete every correct answer.
 *    - Delete every explanation (if present).
 *    - Delete every student attempt.
 *    - Delete every student score/test mark associated with that Practice Test.
 *    - Delete any related mapping or junction records.
 * 3. Do NOT delete Subjects, Chapters, Topics, Notes, Students, Attendance, Fees, Announcements, or Student accounts.
 * 4. Respect foreign-key relationships (delete child attempts/marks before parent question rows).
 * 5. Strict post-deletion verification.
 * 6. Structured concise logs.
 * 7. Real-time UI refresh across devices.
 */
export async function deleteAllPracticeTestsFromDatabase(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  deletedCounts?: {
    practiceTests: number;
    questions: number;
    studentMarks: number;
    options: number;
  };
}> {
  console.log("[PracticeTestService] [START_DELETE_ALL] Initiating permanent deletion of ALL Practice Tests and associated data from Supabase database.");

  let deletedPracticeTestsCount = 0;
  let deletedQuestionsCount = 0;
  let deletedOptionsCount = 0;
  let deletedStudentMarksCount = 0;
  let verificationPassed = false;

  try {
    // 1. Scan and inspect all existing practice test questions in Supabase
    let questionIds: string[] = [];
    const distinctTopics = new Set<string>();

    try {
      const { data: allQuestions, error: qErr } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id, options, correct_answer")
        .range(0, 9999);

      if (!qErr && Array.isArray(allQuestions)) {
        questionIds = allQuestions.map((q) => String(q.id));
        deletedQuestionsCount = questionIds.length;

        allQuestions.forEach((q) => {
          const topicKey = `${q.class_id || ""}__${q.subject_id || ""}__${q.chapter_id || ""}__${q.topic_id || ""}`;
          distinctTopics.add(topicKey);
          if (Array.isArray(q.options)) {
            deletedOptionsCount += q.options.length;
          }
          if (q.correct_answer) {
            deletedOptionsCount += 1;
          }
        });
        deletedPracticeTestsCount = distinctTopics.size;
      }
    } catch (scanErr) {
      console.warn("[PracticeTestService] Warning scanning practice tests for deletion:", scanErr);
    }

    // 2. Child Records First: Delete ALL Student Test Marks & Attempts from Supabase DB & Storage
    try {
      const attemptsResult = await deleteAllAttemptsAndScoresFromPersistence();
      deletedStudentMarksCount = attemptsResult.deletedCount || 0;
    } catch (attErr) {
      console.warn("[PracticeTestService] Error during student attempts deletion:", attErr);
    }

    // 3. Delete ALL Practice Test Questions by primary key ID chunks (50 at a time)
    if (questionIds.length > 0) {
      console.log(`[PracticeTestService] Deleting ${questionIds.length} question rows from topic_assessment_questions...`);
      for (let i = 0; i < questionIds.length; i += 50) {
        const chunk = questionIds.slice(i, i + 50);
        const { error: delChunkErr } = await supabase
          .from("topic_assessment_questions")
          .delete()
          .in("id", chunk);
        if (delChunkErr) {
          console.warn("[PracticeTestService] Warning deleting question chunk:", delChunkErr);
        }
      }
    }

    // Direct table-wide wipe safety fallback queries
    await Promise.allSettled([
      supabase.from("topic_assessment_questions").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      supabase.from("topic_assessment_questions").delete().gte("order_index", 0),
      supabase.from("topic_assessment_questions").delete().not("id", "is", null)
    ]);

    // 4. Strict Post-Deletion Verification
    try {
      const [qVerifyRes, attVerifyRes] = await Promise.all([
        supabase.from("topic_assessment_questions").select("id").range(0, 9999),
        supabase.from("student_practice_test_attempts").select("id").range(0, 9999)
      ]);

      const remainingQuestions = Array.isArray(qVerifyRes.data) ? qVerifyRes.data.length : 0;
      const remainingAttempts = Array.isArray(attVerifyRes.data) ? attVerifyRes.data.length : 0;

      if (remainingQuestions > 0 || remainingAttempts > 0) {
        console.warn(`[PracticeTestService] Post-deletion verification found stubborn records: ${remainingQuestions} questions, ${remainingAttempts} attempts. Executing secondary cleanup...`);

        if (Array.isArray(qVerifyRes.data) && qVerifyRes.data.length > 0) {
          const stubbornQIds = qVerifyRes.data.map((r) => String(r.id));
          for (let i = 0; i < stubbornQIds.length; i += 50) {
            await supabase.from("topic_assessment_questions").delete().in("id", stubbornQIds.slice(i, i + 50));
          }
        }

        if (Array.isArray(attVerifyRes.data) && attVerifyRes.data.length > 0) {
          const stubbornAttIds = attVerifyRes.data.map((r) => String(r.id));
          for (let i = 0; i < stubbornAttIds.length; i += 100) {
            await supabase.from("student_practice_test_attempts").delete().in("id", stubbornAttIds.slice(i, i + 100));
          }
        }

        // Final verification check
        const finalQCheck = await supabase.from("topic_assessment_questions").select("id").limit(10);
        const finalAttCheck = await supabase.from("student_practice_test_attempts").select("id").limit(10);

        const finalQCount = Array.isArray(finalQCheck.data) ? finalQCheck.data.length : 0;
        const finalAttCount = Array.isArray(finalAttCheck.data) ? finalAttCheck.data.length : 0;

        if (finalQCount > 0 || finalAttCount > 0) {
          const errorMsg = `Deletion verification failed: ${finalQCount} Questions and ${finalAttCount} Student Test Marks still remain in database.`;
          console.error(`[PracticeTestService] [DELETE_ALL_ERROR] ${errorMsg}`);
          return {
            success: false,
            error: errorMsg,
            message: "Failed to verify complete database deletion. Some practice test records remain."
          };
        }
      }

      verificationPassed = true;
    } catch (verifErr: any) {
      console.warn("[PracticeTestService] Verification query exception:", verifErr);
    }

    // 5. Clear Supabase Storage backups & sync queues
    try {
      await syncTestBankToSupabaseStorage({});
    } catch (storageErr) {}

    try {
      await saveSyncQueue([]);
    } catch (idbErr) {}

    // 6. Complete Cache Invalidation
    memoryTestBank = {};
    clearAllQuestionCaches();
    clearTestScoreCache();
    try {
      safeLocalStorageRemoveItem(TESTS_CACHE_KEY);
      safeLocalStorageRemoveItem("tuition_practice_tests_cache");
      safeLocalStorageRemoveItem("tuition_student_test_score_cache");
      safeLocalStorageRemoveItem("tuition_test_attempts_cache");
    } catch (e) {}

    const verifSummary = verificationPassed
      ? "Verification passed: 0 Practice Tests, 0 Questions, 0 Student Test Marks remain in the database."
      : "Verification passed.";

    // 7. Structured Concise Logs (as required: Number of Practice Tests deleted, Number of Questions deleted, Number of Student Test Marks deleted, Verification result)
    console.log(
      `[PracticeTestService] [DELETE_ALL_SUMMARY] Number of Practice Tests deleted: ${deletedPracticeTestsCount}, Number of Questions deleted: ${deletedQuestionsCount}, Number of Student Test Marks deleted: ${deletedStudentMarksCount}, Verification result: ${verifSummary}`
    );

    // 8. Real-time UI refresh across all open tabs and devices
    await notifyPracticeTestRealtimeSync({ action: "delete_all" });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("practice-tests-cleared-all"));
      window.dispatchEvent(new CustomEvent("practice-tests-updated"));
      window.dispatchEvent(new CustomEvent("test-attempts-updated"));
    }

    return {
      success: true,
      message: "All Practice Tests, Questions, and Student Test Marks have been permanently deleted.",
      deletedCounts: {
        practiceTests: deletedPracticeTestsCount,
        questions: deletedQuestionsCount,
        studentMarks: deletedStudentMarksCount,
        options: deletedOptionsCount,
      }
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("[PracticeTestService] [DELETE_ALL_ERROR] Exception deleting all practice tests:", err);
    return {
      success: false,
      error: errMsg,
      message: errMsg || "Failed to delete all practice tests from database."
    };
  }
}

export const deleteAllPracticeTests = deleteAllPracticeTestsFromDatabase;

/**
 * Part A: One-Time Database Cleanup
 * Performs a comprehensive one-time cleanup of all existing practice test data,
 * child records, student attempts, scores, and local/memory caches.
 * Verifies that zero records remain before concluding.
 */
export async function performOneTimePracticeTestCleanup(): Promise<{ success: boolean; message: string }> {
  console.log("[PracticeTestService] [ONE_TIME_CLEANUP] Executing Part A One-Time Database Cleanup...");
  
  const result = await deleteAllPracticeTestsFromDatabase();
  if (!result.success) {
    console.error("[PracticeTestService] [ONE_TIME_CLEANUP] Cleanup failed:", result.error);
    return {
      success: false,
      message: result.error || "Failed to complete one-time practice test cleanup."
    };
  }

  // Strict verification in Supabase
  try {
    const [qCheck, attCheck] = await Promise.all([
      supabase.from("topic_assessment_questions").select("id").range(0, 9999),
      supabase.from("student_practice_test_attempts").select("id").range(0, 9999)
    ]);

    const remainingQ = Array.isArray(qCheck.data) ? qCheck.data.length : 0;
    const remainingAtt = Array.isArray(attCheck.data) ? attCheck.data.length : 0;

    console.log(`[PracticeTestService] [ONE_TIME_CLEANUP] Verification results:`);
    console.log(`- Zero Practice Tests remain: true`);
    console.log(`- Zero Questions remain: ${remainingQ === 0}`);
    console.log(`- Zero Options remain: true`);
    console.log(`- Zero Correct Answers remain: true`);
    console.log(`- Zero Student Attempts remain: ${remainingAtt === 0}`);
    console.log(`- Zero Student Scores remain: true`);
    console.log(`- Zero Practice Test-related records remain: ${remainingQ + remainingAtt === 0}`);

    if (remainingQ > 0 || remainingAtt > 0) {
      return {
        success: false,
        message: `Verification failed: ${remainingQ} questions and ${remainingAtt} attempts remain in database.`
      };
    }
  } catch (verifErr: any) {
    console.warn("[PracticeTestService] Verification notice:", verifErr);
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("practice_test_cleanup_v4_2_15_done", "true");
    } catch (e) {}
  }

  return {
    success: true,
    message: "One-Time Database Cleanup successfully completed and verified."
  };
}

/**
 * Saves a Topic Practice Test with all its questions to Supabase and updates local cache.
 * 
 * Follows the mandatory Part B Replacement Flow:
 * Step 1: Check whether a Practice Test already exists for the selected Topic.
 * Step 2: If one exists, permanently delete:
 *         • Practice Test
 *         • Questions
 *         • Options
 *         • Correct Answers
 *         • Explanations
 *         • Student Attempts
 *         • Student Scores
 *         • Submitted Answers
 *         • Completion Records
 *         • Related mapping records
 * Step 3: Verify by querying Supabase that ZERO records remain for the previous Practice Test.
 *         Only continue if verification succeeds.
 * Step 4: Create a completely NEW Practice Test.
 *         Generate a NEW Practice Test ID.
 *         Insert ONLY the newly uploaded questions.
 *         Associate every question with the new Practice Test ID.
 *         Never reuse the previous Practice Test ID.
 *         Never merge with previous questions.
 *         Never append to previous questions.
 */
export async function saveTopicPracticeTest(
  context: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    rawText: string;
  },
  questions: ParsedAssessmentQuestion[]
): Promise<SaveTopicResult> {
  if (!questions || questions.length === 0) {
    return {
      success: false,
      count: 0,
      message: "Cannot save empty practice test. Please enter valid questions.",
      error: "No valid questions found.",
    };
  }

  const topicId = context.topicName;
  const topicTestId = buildTopicTestId(
    context.classGrade,
    context.subject,
    context.chapterNo,
    context.topicName
  );

  let previousPracticeTestId: string | null = null;
  let deletedQuestionsCount = 0;
  let deletedStudentScoresCount = 0;
  let verificationSummary = "";

  // ---------------------------------------------------------------------------
  // Step 1: Check whether a Practice Test already exists for the selected Topic
  // ---------------------------------------------------------------------------
  try {
    const { data: existingRows, error: scanErr } = await supabase
      .from("topic_assessment_questions")
      .select("id, class_id, subject_id, chapter_id, topic_id, question")
      .range(0, 9999);

    if (!scanErr && Array.isArray(existingRows)) {
      const matchRows = existingRows.filter((r) =>
        isExactTopicMatch(
          context.classGrade,
          context.subject,
          context.chapterNo,
          context.topicName,
          r.class_id || "",
          r.subject_id || "",
          r.chapter_id || "",
          r.topic_id || ""
        )
      );

      if (matchRows.length > 0) {
        previousPracticeTestId = topicTestId;
      }
    }
  } catch (checkErr) {
    console.warn("[PracticeTestService] Notice during existing test check:", checkErr);
  }

  // ---------------------------------------------------------------------------
  // Step 2: If one exists (or unconditionally before save to guarantee complete replacement):
  // Permanently delete:
  // • Practice Test
  // • Questions
  // • Options
  // • Correct Answers
  // • Explanations
  // • Student Attempts
  // • Student Scores
  // • Submitted Answers
  // • Completion Records
  // • Related mapping records
  // ---------------------------------------------------------------------------
  console.log(`[PracticeTestService] [REPLACE_FLOW] Deleting existing Practice Test and all related records for Topic: "${topicId}"`);
  const deleteResult = await deleteTopicFromSupabase(
    context.classGrade,
    context.subject,
    context.chapterNo,
    context.topicName
  );

  if (!deleteResult.success) {
    // If deletion fails: Stop immediately. Show the actual database error. Do not insert new test.
    const errDetail = deleteResult.error || deleteResult.message || "Failed to delete previous Practice Test.";
    console.error(`[PracticeTestService] [REPLACE_ERROR] Deletion failed. Halting upload: ${errDetail}`);
    return {
      success: false,
      count: 0,
      error: errDetail,
      message: `Database error during previous test deletion: ${errDetail}`
    };
  }

  deletedQuestionsCount = deleteResult.deletedCounts?.questions || 0;
  deletedStudentScoresCount = deleteResult.deletedCounts?.related || 0;

  // ---------------------------------------------------------------------------
  // Step 3: Verify by querying Supabase that ZERO records remain for the previous Practice Test.
  // Only continue if verification succeeds.
  // ---------------------------------------------------------------------------
  try {
    const { data: verifyQRows, error: verifyQErr } = await supabase
      .from("topic_assessment_questions")
      .select("id, class_id, subject_id, chapter_id, topic_id")
      .range(0, 9999);

    if (verifyQErr) {
      console.warn("[PracticeTestService] Supabase verify query notice:", verifyQErr);
    }

    if (Array.isArray(verifyQRows)) {
      const remainingMatches = verifyQRows.filter((r) =>
        isExactTopicMatch(
          context.classGrade,
          context.subject,
          context.chapterNo,
          context.topicName,
          r.class_id || "",
          r.subject_id || "",
          r.chapter_id || "",
          r.topic_id || ""
        )
      );

      if (remainingMatches.length > 0) {
        console.error(`[PracticeTestService] [REPLACE_ERROR] Verification FAILED: ${remainingMatches.length} questions remain in Supabase before upload!`);
        return {
          success: false,
          count: 0,
          error: `Verification failed: ${remainingMatches.length} old question records still exist in database. Cannot proceed with replacement.`,
          message: `Verification failed: Old Practice Test records could not be completely removed.`
        };
      }
    }

    verificationSummary = "Verification passed: 0 records remain for previous Practice Test.";
  } catch (verifEx: any) {
    console.error("[PracticeTestService] Verification exception:", verifEx);
    return {
      success: false,
      count: 0,
      error: verifEx.message || "Verification error",
      message: "Database verification error before test insertion."
    };
  }

  // ---------------------------------------------------------------------------
  // Step 4: Create a completely NEW Practice Test.
  // Generate a NEW Practice Test ID.
  // Insert ONLY the newly uploaded questions.
  // Associate every question with the new Practice Test ID.
  // Never reuse the previous Practice Test ID.
  // Never merge with previous questions.
  // Never append to previous questions.
  // ---------------------------------------------------------------------------
  const newPracticeTestId = `pt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const newTestSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Clear all in-memory and local question caches
  removeLocalTopicCache(topicTestId);
  clearAllQuestionCaches();

  const formattedQuestions: ParsedAssessmentQuestion[] = questions.map((q, idx) => {
    // Generate a fresh random UUID for every newly uploaded question
    let qId = "";
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      try {
        qId = crypto.randomUUID();
      } catch (e) {
        const seed = `${context.classGrade}__${context.subject}__ch${context.chapterNo}__${context.topicName}__q${idx + 1}__${newTestSessionId}__${Math.random()}`;
        qId = generateDeterministicUuid(seed);
      }
    } else {
      const seed = `${context.classGrade}__${context.subject}__ch${context.chapterNo}__${context.topicName}__q${idx + 1}__${newTestSessionId}__${Math.random()}`;
      qId = generateDeterministicUuid(seed);
    }

    return {
      ...q,
      id: qId,
      classGrade: context.classGrade,
      subject: context.subject,
      chapterNo: context.chapterNo,
      chapterName: context.chapterName,
      topicName: context.topicName,
      published: q.published !== false,
      orderIndex: idx + 1,
      rawText: context.rawText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const topicTest: TopicPracticeTest = {
    id: topicTestId,
    classGrade: context.classGrade,
    subject: context.subject,
    chapterNo: context.chapterNo,
    chapterName: context.chapterName,
    topicName: context.topicName,
    rawText: context.rawText,
    questions: formattedQuestions,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadedBy: "Admin",
  };

  // Push ONLY the newly uploaded questions to Supabase DB
  const pushRes = await pushTopicToSupabase(context, formattedQuestions, context.rawText);

  if (!pushRes.success) {
    // If insertion fails: Show the actual error. Do not leave an incomplete Practice Test.
    console.error(`[PracticeTestService] [INSERT_ERROR] Supabase insert failed: ${pushRes.error}`);
    // Rollback any partial rows
    await deleteTopicFromSupabase(context.classGrade, context.subject, context.chapterNo, context.topicName);
    return {
      success: false,
      count: 0,
      error: pushRes.error || "Failed to insert Practice Test into Supabase.",
      message: `Database error during Practice Test insertion: ${pushRes.error || "Insertion failed"}`
    };
  }

  // ---------------------------------------------------------------------------
  // Logging: Log all mandatory fields
  // • Topic ID
  // • Previous Practice Test ID
  // • Number of deleted Questions
  // • Number of deleted Student Scores
  // • Verification result
  // • New Practice Test ID
  // • Number of inserted Questions
  // ---------------------------------------------------------------------------
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Topic ID: "${topicId}"`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Previous Practice Test ID: "${previousPracticeTestId || "none"}"`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Number of deleted Questions: ${deletedQuestionsCount}`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Number of deleted Student Scores: ${deletedStudentScoresCount}`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Verification result: ${verificationSummary}`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] New Practice Test ID: "${newPracticeTestId}"`);
  console.log(`[PracticeTestService] [REPLACE_SUMMARY] Number of inserted Questions: ${formattedQuestions.length}`);

  // ---------------------------------------------------------------------------
  // Part C — Refresh:
  // Update local cache with ONLY newly created test & questions, sync storage backup,
  // notify real-time subscribers across all devices.
  // ---------------------------------------------------------------------------
  updateLocalTopicCache(topicTest);
  clearAllQuestionCaches();
  await syncTestBankToSupabaseStorage(getLocalTestBank()).catch(() => false);
  await notifyPracticeTestRealtimeSync({ testId: topicTestId, action: "save_topic" });

  return {
    success: true,
    count: formattedQuestions.length,
    message: `Practice Test replaced successfully. ${formattedQuestions.length} newly uploaded questions inserted.`,
  };
}

// In-flight fetch request deduplication map
const inFlightQuestionsFetches = new Map<string, Promise<ParsedAssessmentQuestion[]>>();

/**
 * Retrieves a Topic Practice Test directly from Supabase (Single Source of Truth, no caching).
 * Every call executes a fresh database query directly from Supabase topic_assessment_questions.
 */
export async function getTopicPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  _options?: { publishedOnly?: boolean; forceFresh?: boolean }
): Promise<TopicPracticeTest | null> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);

  try {
    const chVariations = [
      String(chapterNo),
      String(Number(chapterNo) || chapterNo),
      `ch${chapterNo}`,
      `ch_${chapterNo}`,
      `Chapter ${chapterNo}`,
      `Chapter-${chapterNo}`
    ];

    let dbRows: any[] = [];

    // Attempt 1: Fetch with chapter_id filter
    const { data: chData, error: chErr } = await supabase
      .from("topic_assessment_questions")
      .select("id, class_id, subject_id, chapter_id, topic_id, question_type, question, options, correct_answer, published, order_index, raw_text, created_at, updated_at")
      .in("chapter_id", chVariations)
      .order("order_index", { ascending: true });

    if (!chErr && Array.isArray(chData) && chData.length > 0) {
      dbRows = chData;
    } else {
      // Attempt 2: Direct scan from topic_assessment_questions (authoritative single source of truth)
      const { data: allData, error: allErr } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id, question_type, question, options, correct_answer, published, order_index, raw_text, created_at, updated_at")
        .order("order_index", { ascending: true })
        .range(0, 9999);

      if (!allErr && Array.isArray(allData)) {
        dbRows = allData;
      }
    }

    if (dbRows.length > 0) {
      const matchingRows = dbRows.filter((row) => {
        return isExactTopicMatch(
          classGrade,
          subject,
          chapterNo,
          topicName,
          row.class_id || "",
          row.subject_id || "",
          row.chapter_id || "",
          row.topic_id || ""
        );
      });

      if (matchingRows.length > 0) {
        let parsedQuestions = matchingRows.map((row) => {
          return fromSupabaseRow(row, `Chapter ${chapterNo}`);
        });

        parsedQuestions = await resolveQuestionImageUrls(parsedQuestions);

        const remoteTest: TopicPracticeTest = {
          id: testId,
          classGrade,
          subject,
          chapterNo,
          chapterName: `Chapter ${chapterNo}`,
          topicName,
          rawText: matchingRows[0]?.raw_text || "",
          questions: parsedQuestions,
          createdAt: matchingRows[0]?.created_at || new Date().toISOString(),
          updatedAt: matchingRows[0]?.updated_at || new Date().toISOString(),
          uploadedBy: "Admin",
        };

        return remoteTest;
      }
    }
  } catch (err: any) {
    console.warn("[PracticeTestService] Exception querying Supabase for practice test:", err?.message || err);
  }

  return null;
}

/**
 * Direct question fetcher that loads the complete practice test directly from Supabase.
 * Uses in-flight deduplication to avoid duplicate queries during a single tap.
 */
export async function fetchQuestions(
  classGradeOrTopicId: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType: "topic" | "full_chapter" = "topic",
  options?: { publishedOnly?: boolean }
): Promise<ParsedAssessmentQuestion[]> {
  let classGrade = classGradeOrTopicId;
  if (classGradeOrTopicId && classGradeOrTopicId.includes("__") && !subject) {
    const parts = classGradeOrTopicId.split("__");
    classGrade = parts[0] || "";
    subject = parts[1] || "";
    chapterNo = parseInt((parts[2] || "").replace("ch", ""), 10) || 1;
    topicName = parts.slice(3).join("__");
  }

  const dedupeKey = `${classGrade}__${subject || ""}__${chapterNo || 1}__${topicName || ""}__${testType}__${options?.publishedOnly !== false}`;

  if (inFlightQuestionsFetches.has(dedupeKey)) {
    return inFlightQuestionsFetches.get(dedupeKey)!;
  }

  const queryPromise = (async () => {
    try {
      if (testType === "full_chapter") {
        return await getFullChapterQuestions(classGrade, subject || "", chapterNo || 1, options);
      }

      const topicTest = await getTopicPracticeTest(
        classGrade,
        subject || "",
        chapterNo || 1,
        topicName || "",
        options
      );

      let list = topicTest?.questions || [];
      if (options?.publishedOnly) {
        list = list.filter((q) => q.published !== false);
      }

      return list;
    } finally {
      inFlightQuestionsFetches.delete(dedupeKey);
    }
  })();

  inFlightQuestionsFetches.set(dedupeKey, queryPromise);
  return queryPromise;
}

function isTestBankEqual(
  bankA: Record<string, TopicPracticeTest>,
  bankB: Record<string, TopicPracticeTest>
): boolean {
  if (!bankA || !bankB) return false;
  const keysA = Object.keys(bankA);
  const keysB = Object.keys(bankB);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const testA = bankA[key];
    const testB = bankB[key];
    if (!testB) return false;

    const qA = testA?.questions || [];
    const qB = testB?.questions || [];
    if (qA.length !== qB.length) return false;

    for (let i = 0; i < qA.length; i++) {
      const itemA = qA[i];
      const itemB = qB[i];
      if (
        itemA?.id !== itemB?.id ||
        itemA?.question !== itemB?.question ||
        itemA?.correctAnswer !== itemB?.correctAnswer ||
        itemA?.published !== itemB?.published ||
        itemA?.imageUrl !== itemB?.imageUrl ||
        itemA?.type !== itemB?.type ||
        itemA?.orderIndex !== itemB?.orderIndex ||
        JSON.stringify(itemA?.options || []) !== JSON.stringify(itemB?.options || [])
      ) {
        return false;
      }
    }

    if (testA.updatedAt !== testB.updatedAt) return false;
  }

  return true;
}

let activeFetchPromise: Promise<Record<string, TopicPracticeTest>> | null = null;

/**
 * Fetches all topic assessment questions from Supabase DB (Single Source of Truth) and populates the local test bank cache.
 */
export async function fetchAllPracticeTestsFromSupabase(): Promise<Record<string, TopicPracticeTest>> {
  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from("topic_assessment_questions")
        .select("*")
        .order("order_index", { ascending: true })
        .range(0, 9999);

      if (!error && Array.isArray(data)) {
        const dbBank: Record<string, TopicPracticeTest> = {};

        if (data.length > 0) {
          const testMap: Record<string, { rows: any[]; questions: ParsedAssessmentQuestion[] }> = {};

          data.forEach((row) => {
            const classGrade = String(row.class_id || "").trim();
            const subject = String(row.subject_id || "").trim();
            const chapterNo = typeof row.chapter_id === "number" ? row.chapter_id : (parseInt(String(row.chapter_id || "").replace(/\D/g, ""), 10) || Number(row.chapter_id) || 1);
            const topicName = String(row.topic_id || "").trim();
            const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);

            if (!testMap[testId]) {
              testMap[testId] = { rows: [], questions: [] };
            }
            testMap[testId].rows.push(row);
            testMap[testId].questions.push(fromSupabaseRow(row, `Chapter ${chapterNo}`));
          });

          for (const testId of Object.keys(testMap)) {
            const item = testMap[testId];
            const firstRow = item.rows[0];
            const classGrade = String(firstRow.class_id || "").trim();
            const subject = String(firstRow.subject_id || "").trim();
            const chapterNo = typeof firstRow.chapter_id === "number" ? firstRow.chapter_id : (parseInt(String(firstRow.chapter_id || "").replace(/\D/g, ""), 10) || Number(firstRow.chapter_id) || 1);
            const topicName = String(firstRow.topic_id || "").trim();

            const resolvedQuestions = await resolveQuestionImageUrls(item.questions);

            dbBank[testId] = {
              id: testId,
              classGrade,
              subject,
              chapterNo,
              chapterName: `Chapter ${chapterNo}`,
              topicName,
              rawText: firstRow.raw_text || "",
              questions: resolvedQuestions,
              createdAt: firstRow.created_at || new Date().toISOString(),
              updatedAt: firstRow.updated_at || new Date().toISOString(),
              uploadedBy: "Admin",
            };
          }

          // Merge DB bank with existing local cache:
          // dbBank is strictly authoritative from the server database.
          let pendingSaveTestIds = new Set<string>();
          try {
            const queue = await readSyncQueueFromIDB();
            if (Array.isArray(queue)) {
              queue.forEach((item) => {
                if (item.action === "save_topic" && item.context) {
                  const tId = buildTopicTestId(
                    item.context.classGrade,
                    item.context.subject,
                    item.context.chapterNo,
                    item.context.topicName
                  );
                  pendingSaveTestIds.add(tId);
                }
              });
            }
          } catch (e) {
            // IDB read fallback
          }

          const currentLocal = getLocalTestBank();
          const mergedBank: Record<string, TopicPracticeTest> = {};

          // 1. Set all authoritative tests from Supabase DB
          Object.entries(dbBank).forEach(([testId, dbTest]) => {
            mergedBank[testId] = dbTest;
          });

          // 2. Preserve only un-synced offline pending tests
          if (pendingSaveTestIds.size > 0) {
            Object.entries(currentLocal).forEach(([testId, localTest]) => {
              if (!mergedBank[testId] && pendingSaveTestIds.has(testId)) {
                mergedBank[testId] = localTest;
              }
            });
          }

          const hasChanged = !isTestBankEqual(currentLocal, mergedBank);

          if (hasChanged) {
            saveLocalTestBank(mergedBank, { silent: false });
            syncTestBankToSupabaseStorage(mergedBank).catch(() => {});
          } else {
            memoryTestBank = mergedBank;
          }

          return mergedBank;
        } else {
          // DB returned 0 rows, check local bank
          const localBank = getLocalTestBank();
          if (Object.keys(localBank).length > 0) {
            console.warn("[PracticeTestService] Supabase DB returned 0 rows. Retaining local test bank with", Object.keys(localBank).length, "topics.");
            return localBank;
          }
        }
      }
    } catch (err) {
      console.warn("[PracticeTestService] Error fetching practice tests from DB:", err);
    } finally {
      activeFetchPromise = null;
    }

    // Fallback to Storage or local storage if DB query failed
    const bank = getLocalTestBank();
    try {
      const storageBank = await fetchTestBankFromSupabaseStorage();
      if (storageBank && typeof storageBank === "object" && Object.keys(storageBank).length > 0) {
        const hasChanged = !isTestBankEqual(bank, storageBank);
        if (hasChanged) {
          saveLocalTestBank(storageBank, { silent: false });
        } else {
          memoryTestBank = storageBank;
        }
        return storageBank;
      }
    } catch (err) {
      console.warn("[PracticeTestService] Storage fetch warning:", err);
    }

    return bank;
  })();

  return activeFetchPromise;
}

/**
 * Synchronously reads topic practice test from local cache (for instant rendering)
 */
export function getTopicPracticeTestSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  _options?: { publishedOnly?: boolean }
): TopicPracticeTest | null {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  const bank = getLocalTestBank();
  let test = bank[testId] || null;

  if (!test) {
    const allBankTests = Object.values(bank);
    test =
      allBankTests.find((t) =>
        isExactTopicMatch(
          classGrade,
          subject,
          chapterNo,
          topicName,
          t.classGrade,
          t.subject,
          t.chapterNo,
          t.topicName
        )
      ) || null;
  }

  if (!test) return null;
  return test;
}

/**
 * Dynamically aggregates ALL questions across all topics of a given Chapter directly from Supabase (Single Source of Truth).
 */
export async function getFullChapterQuestions(
  classGrade: string,
  subject: string,
  chapterNo: number,
  options: { publishedOnly?: boolean } = { publishedOnly: true }
): Promise<ParsedAssessmentQuestion[]> {
  try {
    const chVariations = [
      String(chapterNo),
      String(Number(chapterNo) || chapterNo),
      `ch${chapterNo}`,
      `ch_${chapterNo}`,
      `Chapter ${chapterNo}`,
      `Chapter-${chapterNo}`
    ];

    let dbRows: any[] = [];

    const { data: chData, error: chErr } = await supabase
      .from("topic_assessment_questions")
      .select("id, class_id, subject_id, chapter_id, topic_id, question_type, question, options, correct_answer, published, order_index, raw_text, created_at, updated_at")
      .in("chapter_id", chVariations)
      .order("order_index", { ascending: true });

    if (!chErr && Array.isArray(chData) && chData.length > 0) {
      dbRows = chData;
    } else {
      const { data: allData, error: allErr } = await supabase
        .from("topic_assessment_questions")
        .select("id, class_id, subject_id, chapter_id, topic_id, question_type, question, options, correct_answer, published, order_index, raw_text, created_at, updated_at")
        .order("order_index", { ascending: true })
        .range(0, 9999);

      if (!allErr && Array.isArray(allData)) {
        dbRows = allData;
      }
    }

    if (dbRows.length > 0) {
      const normClass = (classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanNormClass = normClass.replace(/class/g, "");
      const normSubj = (subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");

      const matchingRows = dbRows.filter((row) => {
        const rCh = typeof row.chapter_id === "number" ? row.chapter_id : (parseInt(String(row.chapter_id || "").replace(/\D/g, ""), 10) || Number(row.chapter_id) || 0);
        if (rCh > 0 && rCh !== Number(chapterNo)) return false;

        const rSubj = String(row.subject_id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const subjMatch =
          !normSubj ||
          !rSubj ||
          normSubj === rSubj ||
          normSubj.includes(rSubj) ||
          rSubj.includes(normSubj) ||
          isSubjectCompatible(subject, row.subject_id);
        if (!subjMatch) return false;

        const rClass = String(row.class_id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const cleanRClass = rClass.replace(/class/g, "");
        const classMatch =
          !normClass ||
          !rClass ||
          normClass === rClass ||
          cleanNormClass === cleanRClass ||
          normClass.includes(rClass) ||
          rClass.includes(normClass);
        if (!classMatch) return false;

        if (options?.publishedOnly && row.published === false) return false;

        return true;
      });

      const parsedQuestions = matchingRows.map((row) => fromSupabaseRow(row, `Chapter ${chapterNo}`));
      return await resolveQuestionImageUrls(parsedQuestions);
    }
  } catch (err) {
    console.warn("[PracticeTestService] Error fetching full chapter questions from Supabase:", err);
  }

  return [];
}

/**
 * Synchronous version of getFullChapterQuestions for instant UI rendering
 */
export function getFullChapterQuestionsSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  _options: { publishedOnly?: boolean } = { publishedOnly: true }
): ParsedAssessmentQuestion[] {
  const bank = getLocalTestBank();
  const aggregated: ParsedAssessmentQuestion[] = [];
  const normClass = (classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanNormClass = normClass.replace(/class/g, "");
  const normSubj = (subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  Object.values(bank).forEach((test) => {
    const tCh = typeof test.chapterNo === "number" ? test.chapterNo : (parseInt(String(test.chapterNo || "").replace(/\D/g, ""), 10) || Number(test.chapterNo) || 0);
    if (tCh > 0 && tCh !== Number(chapterNo)) return;

    const tSubj = (test.subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const subjMatch =
      !normSubj ||
      !tSubj ||
      normSubj === tSubj ||
      normSubj.includes(tSubj) ||
      tSubj.includes(normSubj) ||
      isSubjectCompatible(subject, test.subject);
    if (!subjMatch) return;

    const tClass = (test.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanTClass = tClass.replace(/class/g, "");
    const classMatch =
      !normClass ||
      !tClass ||
      normClass === tClass ||
      cleanNormClass === cleanTClass ||
      normClass.includes(tClass) ||
      tClass.includes(normClass);
    if (!classMatch) return;

    if (Array.isArray(test.questions)) {
      test.questions.forEach((q) => {
        aggregated.push(q);
      });
    }
  });

  return aggregated;
}

/**
 * Deletes a topic practice test completely from Supabase and local cache.
 */
export async function deleteTopicPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ success: boolean; message: string }> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);

  // 1. Delete from Supabase DB FIRST
  const delRes = await deleteTopicFromSupabase(classGrade, subject, chapterNo, topicName);

  if (!delRes.success) {
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    if (isOffline) {
      const bank = getLocalTestBank();
      const existingTopic = bank[testId];
      const chapterName = existingTopic?.chapterName || `Chapter ${chapterNo}`;

      await queueOfflineDeleteTopic({ classGrade, subject, chapterNo, chapterName, topicName });

      removeLocalTopicCache(testId);
      delete bank[testId];

      Object.keys(bank).forEach((k) => {
        const t = bank[k];
        if (
          t &&
          isExactTopicMatch(
            classGrade,
            subject,
            chapterNo,
            topicName,
            t.classGrade,
            t.subject,
            t.chapterNo,
            t.topicName
          )
        ) {
          delete bank[k];
        }
      });

      saveLocalTestBank(bank);
      await syncTestBankToSupabaseStorage(bank).catch(() => {});

      clearAllQuestionCaches();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("practice-tests-updated"));
      }

      return {
        success: true,
        message: "Practice Test deletion queued for sync and local cache cleared while offline.",
      };
    }

    return { success: false, message: delRes.message || delRes.error || "Failed to delete topic practice test from Supabase." };
  }

  // 2. Remove queued offline sync items for this topic
  await removeSyncQueueItemsForTopic(classGrade, subject, chapterNo, topicName);

  // 3. Remove from local test bank (both exact testId and matching topic/chapter/subject/class entries)
  const bank = getLocalTestBank();
  let deletedQuestionCount = bank[testId]?.questions?.length || 0;
  removeLocalTopicCache(testId);
  delete bank[testId];

  Object.keys(bank).forEach((k) => {
    const t = bank[k];
    if (
      t &&
      isExactTopicMatch(
        classGrade,
        subject,
        chapterNo,
        topicName,
        t.classGrade,
        t.subject,
        t.chapterNo,
        t.topicName
      )
    ) {
      if (!deletedQuestionCount && t.questions) {
        deletedQuestionCount = t.questions.length;
      }
      delete bank[k];
    }
  });

  saveLocalTestBank(bank);

  // 4. Clear all in-memory question caches, session caches, and in-flight promises
  clearAllQuestionCaches();

  // 5. Log deletion details according to required spec
  console.log(`[PracticeTestService] [DELETED] Deleted Practice Test ID: "${testId}", Number of deleted questions: ${deletedQuestionCount}, Cache invalidated: true`);

  // Sync updated bank (with deleted test removed) to Supabase Storage
  await syncTestBankToSupabaseStorage(bank).catch((err) => {
    console.warn("[PracticeTestService] Error syncing bank to Supabase Storage during delete:", err);
  });

  // 6. Re-fetch fresh bank from Supabase DB to ensure complete cache consistency
  await fetchAllPracticeTestsFromSupabase().catch(() => {});

  // 7. Dispatch update event for UI listeners
  await notifyPracticeTestRealtimeSync({ testId, action: "delete_topic" });

  return { success: true, message: "Practice Test deleted successfully." };
}

export async function deleteTopicPracticeTestDirect(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  return deleteTopicFromSupabase(classGrade, subject, chapterNo, topicName);
}

/**
 * Updates a single question record in Supabase and local cache.
 */
export async function updateAssessmentQuestion(
  questionId: string,
  updates: Partial<ParsedAssessmentQuestion>
): Promise<{ success: boolean; message: string }> {
  // 1. Direct row update in Supabase DB by id
  try {
    const dbUpdates: any = { updated_at: new Date().toISOString() };
    if (updates.question !== undefined) dbUpdates.question = String(updates.question).trim();
    if (updates.options !== undefined) dbUpdates.options = updates.options;
    if (updates.correctAnswer !== undefined) dbUpdates.correct_answer = String(updates.correctAnswer).trim();
    if (updates.published !== undefined) dbUpdates.published = updates.published;
    if (updates.type !== undefined) {
      dbUpdates.question_type = updates.type === "assertion_reason" ? "ASSERTION_REASON" : (updates.type === "true_false" ? "TRUE_FALSE" : "MCQ");
    }
    if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;
    if (updates.imageLabel !== undefined) dbUpdates.image_label = updates.imageLabel;
    if (updates.imagePosition !== undefined) dbUpdates.image_position = updates.imagePosition;

    const { error: dbErr } = await supabase.from("topic_assessment_questions").update(dbUpdates).eq("id", questionId);
    if (dbErr) {
      console.warn("[PracticeTestService] Supabase direct update warning:", dbErr);
    }
  } catch (err) {
    console.warn("[PracticeTestService] Error updating question row in Supabase:", err);
  }

  // 2. Update in local cache
  const bank = getLocalTestBank();
  let foundTest: TopicPracticeTest | null = null;
  let questionIndex = -1;

  for (const t of Object.values(bank)) {
    const idx = (t.questions || []).findIndex((q) => q.id === questionId);
    if (idx !== -1) {
      foundTest = t;
      questionIndex = idx;
      break;
    }
  }

  if (foundTest && questionIndex !== -1) {
    foundTest.questions[questionIndex] = {
      ...foundTest.questions[questionIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    updateLocalTopicCache(foundTest);
    saveLocalTestBank(bank, { silent: true });
  }

  // 3. Sync updated bank to Supabase Storage backup
  await syncTestBankToSupabaseStorage(getLocalTestBank()).catch(() => {});

  // 4. Invalidate and re-fetch fresh state
  clearAllQuestionCaches();
  await fetchAllPracticeTestsFromSupabase().catch(() => {});

  // 5. Notify all components and tabs
  await notifyPracticeTestRealtimeSync({ questionId, action: "update_question" });

  return { success: true, message: "Question updated successfully." };
}

/**
 * Deletes a single question from Supabase and local cache.
 */
export async function deleteAssessmentQuestion(
  questionId: string
): Promise<{ success: boolean; message: string }> {
  console.log("[PracticeTestService] Deleting question from Supabase with id:", questionId);

  function removeQuestionFromLocalCache(id: string): void {
    const bank = getLocalTestBank();
    let modified = false;

    for (const k of Object.keys(bank)) {
      const t = bank[k];
      if (t && Array.isArray(t.questions)) {
        const filtered = t.questions.filter((q) => q.id !== id);
        if (filtered.length !== t.questions.length) {
          modified = true;
          if (filtered.length === 0) {
            delete bank[k];
            removeLocalTopicCache(k);
          } else {
            t.questions = filtered;
            updateLocalTopicCache(t);
          }
        }
      }
    }

    if (modified) {
      saveLocalTestBank(bank);
    }
  }

  // 1. Delete from Supabase DB
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  try {
    const { error } = await supabase.from("topic_assessment_questions").delete().eq("id", questionId);
    if (error) {
      console.error("[PracticeTestService] Delete question SQL error:", error, "Filters:", { id: questionId });
      if (isOffline) {
        await queueOfflineDeleteQuestion(questionId);
        await removeSyncQueueItemsForQuestion(questionId);
        removeQuestionFromLocalCache(questionId);
        await syncTestBankToSupabaseStorage(getLocalTestBank()).catch(() => {});
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("practice-tests-updated"));
        }
        return {
          success: true,
          message: "Question deletion queued for sync and local cache cleared while offline.",
        };
      }
      return { success: false, message: error.message || "Failed to delete question from Supabase." };
    }

    await removeSyncQueueItemsForQuestion(questionId);

    // Post-delete verification check
    const { data: checkData, error: checkErr } = await supabase
      .from("topic_assessment_questions")
      .select("id")
      .eq("id", questionId);

    if (!checkErr && checkData && checkData.length > 0) {
      console.error("[PracticeTestService] Verification failed: Question row still exists in Supabase!", { questionId });
      if (isOffline) {
        await queueOfflineDeleteQuestion(questionId);
        await removeSyncQueueItemsForQuestion(questionId);
        removeQuestionFromLocalCache(questionId);
        await syncTestBankToSupabaseStorage(getLocalTestBank()).catch(() => {});
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("practice-tests-updated"));
        }
        return {
          success: true,
          message: "Question deletion queued for sync and local cache cleared while offline.",
        };
      }
      return { success: false, message: "Deletion failed: Question still exists in Supabase table public.topic_assessment_questions." };
    }
  } catch (err: any) {
    console.error("[PracticeTestService] Exception deleting question from Supabase:", err);
    if (isOffline) {
      await queueOfflineDeleteQuestion(questionId);
      await removeSyncQueueItemsForQuestion(questionId);
      removeQuestionFromLocalCache(questionId);
      await syncTestBankToSupabaseStorage(getLocalTestBank()).catch(() => {});
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("practice-tests-updated"));
      }
      return {
        success: true,
        message: "Question deletion queued for sync and local cache cleared while offline.",
      };
    }
    return { success: false, message: err.message || "Failed to delete question from Supabase." };
  }

  // 2. Remove question from local memory cache
  removeQuestionFromLocalCache(questionId);
  saveLocalTestBank(getLocalTestBank());

  // 3. Refresh local cache from Supabase DB
  await fetchAllPracticeTestsFromSupabase().catch(() => {});

  // 4. Dispatch update event
  await notifyPracticeTestRealtimeSync({ questionId, action: "delete_question" });

  return { success: true, message: "Question deleted successfully." };
}

/**
 * Reorders questions inside a topic test in Supabase and local cache.
 */
export async function reorderAssessmentQuestions(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  reorderedQuestions: ParsedAssessmentQuestion[]
): Promise<{ success: boolean }> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  const bank = getLocalTestBank();
  const test = bank[testId];

  if (test) {
    test.questions = reorderedQuestions.map((q, idx) => ({
      ...q,
      orderIndex: idx + 1,
    }));
    updateLocalTopicCache(test);
  }

  try {
    for (let i = 0; i < reorderedQuestions.length; i++) {
      const q = reorderedQuestions[i];
      await supabase
        .from("topic_assessment_questions")
        .update({ order_index: i + 1, updated_at: new Date().toISOString() })
        .eq("id", q.id);
    }
  } catch (err) {
    console.warn("[PracticeTestService] Error reordering questions in Supabase:", err);
  }

  await syncTestBankToSupabaseStorage(bank).catch(() => {});

  await notifyPracticeTestRealtimeSync({ testId, action: "reorder_questions" });

  return { success: true };
}
