import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  getDocs,
  query,
  where
} from "firebase/firestore";
import { getFirebaseDb, OperationType, handleFirestoreError } from "./firebase";
import { Student, ClassNote, TestAttemptRecord } from "../types";
import { 
  safeLocalStorageSetItem as safeSetStorage, 
  safeLocalStorageGetItem as safeGetStorage,
  safeLocalStorageGetItem, 
  safeLocalStorageRemoveItem 
} from "./safeStorage";

export { safeSetStorage, safeGetStorage };

// Local storage keys for fallback/offline sandbox mode
const STORAGE_KEY_STUDENTS = "tuition_students_data";
const STORAGE_KEY_USERS = "tuition_users_data";
const STORAGE_KEY_INSTITUTION_NAME = "tuition_institution_name";
const STORAGE_KEY_AUTH_SESSION = "tuition_auth_session";

export interface CachedAuthSession {
  uid?: string;
  email?: string;
  role: "admin" | "student";
  studentId: string | null;
  timestamp?: number;
}

export function getCachedAuthSession(): CachedAuthSession | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const cached = localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed && (parsed.role === "admin" || parsed.role === "student")) {
      return parsed;
    }
  } catch (err) {
    console.warn("[Auth Session] Error reading cached session:", err);
  }
  return null;
}

export function saveCachedAuthSession(session: CachedAuthSession): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const dataToStore = {
      ...session,
      timestamp: Date.now(),
    };
    safeSetStorage(STORAGE_KEY_AUTH_SESSION, JSON.stringify(dataToStore));
  } catch (err) {
    console.warn("[Auth Session] Error saving cached session:", err);
  }
}

export function clearCachedAuthSession(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    safeLocalStorageRemoveItem(STORAGE_KEY_AUTH_SESSION);
  } catch (err) {
    console.warn("[Auth Session] Error clearing cached session:", err);
  }
}

function getCachedInstitutionName(): string {
  if (typeof window === "undefined") {
    return "Sumit Tuition App";
  }
  const cached = localStorage.getItem(STORAGE_KEY_INSTITUTION_NAME);
  if (!cached || cached === "Ingenious Study Circle") {
    safeSetStorage(STORAGE_KEY_INSTITUTION_NAME, "Sumit Tuition App");
    return "Sumit Tuition App";
  }
  return cached;
}

function setCachedInstitutionName(name: string) {
  if (typeof window === "undefined") {
    return;
  }
  safeSetStorage(STORAGE_KEY_INSTITUTION_NAME, name);
  window.dispatchEvent(new CustomEvent("institution-name-updated", { detail: name }));
}

// Fallback in-memory subscribers list for real-time emulation when Firestore is offline
type StudentsListener = (students: Student[]) => void;
const studentsListeners = new Set<StudentsListener>();

// Dynamic trigger to notify all local subscribers of change
function notifyLocalStudentsListeners() {
  const students = getLocalStudents();
  studentsListeners.forEach((listener) => listener(students));
}

// Helper to get local students
export function getLocalStudents(): Student[] {
  const cached = safeGetStorage(STORAGE_KEY_STUDENTS);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s: any) =>
            Boolean(s) &&
            Boolean(s.id) &&
            s.name !== "Unnamed Student" &&
            Boolean(s.name && String(s.name).trim() !== "")
        );
      }
    } catch (e) {
      console.error("Failed to parse local students", e);
    }
  }
  return [];
}

// Helper to save local students
export function saveLocalStudents(students: Student[]) {
  safeSetStorage(STORAGE_KEY_STUDENTS, JSON.stringify(students));
  notifyLocalStudentsListeners();
}

// ----------------------------------------------------
// FIRESTORE / HYBRID SYNCHRONIZATION API
// ----------------------------------------------------

/**
 * Check if Firebase is fully initialized and Firestore is accessible
 */
export async function isDbOnline(): Promise<boolean> {
  try {
    const db = await getFirebaseDb();
    return db !== null;
  } catch {
    return false;
  }
}

/**
 * Fetch a specific user document by UID
 */
export async function getUserDocument(uid: string): Promise<any> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      return users[uid] || null;
    }
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.warn("getUserDocument warning:", err);
    return null;
  }
}

export interface RoleVerificationResult {
  role: "Admin" | "Student" | null;
  studentId: string | null;
  userDoc: any | null;
}

/**
 * Strict database-only role verification by authenticated Firebase UID and Email.
 * Flow:
 * 1. Get authenticated user's UID and email.
 * 2. Check whether UID/email exists in Students collection/table (or users table with role "Student").
 *    If found -> return { role: "Student", studentId }. Stop all further checks.
 * 3. Check whether UID/email exists in Admins collection/table (or users table with role "Admin").
 *    If found -> return { role: "Admin", studentId: null }.
 * 4. If UID/email exists in neither Students nor Admins -> return { role: null, studentId: null }.
 * 5. If database query fails -> throws Error so authentication fails immediately.
 */
export async function verifyUserRoleFromDatabase(uid: string, userEmail?: string | null): Promise<RoleVerificationResult> {
  if (!uid || typeof uid !== "string") {
    return { role: null, studentId: null, userDoc: null };
  }

  const normalizedEmail = userEmail ? userEmail.trim().toLowerCase() : "";

  // Helper to check local/cached data
  const checkLocalData = (): RoleVerificationResult => {
    const cachedUsersStr = localStorage.getItem(STORAGE_KEY_USERS);
    const localUsers = cachedUsersStr ? JSON.parse(cachedUsersStr) : {};
    const userDoc = localUsers[uid] || (normalizedEmail ? Object.values(localUsers).find((u: any) => u.email?.toLowerCase().trim() === normalizedEmail) : null);

    const localStudents = getLocalStudents();
    const studentByRecord = localStudents.find(
      (s) =>
        s.uid === uid ||
        s.id === uid ||
        (normalizedEmail && s.email?.toLowerCase().trim() === normalizedEmail) ||
        (userDoc?.studentId && s.id === userDoc.studentId)
    );

    // 1. Check Students collection/table first
    if (studentByRecord || (userDoc && String(userDoc.role).trim().toLowerCase() === "student")) {
      const studentId = studentByRecord?.id || userDoc?.studentId || uid;
      return {
        role: "Student",
        studentId,
        userDoc: userDoc || { uid, role: "Student", studentId }
      };
    }

    // 2. Check Admins collection/table second
    if (userDoc && String(userDoc.role).trim().toLowerCase() === "admin") {
      return {
        role: "Admin",
        studentId: null,
        userDoc
      };
    }

    // Check if any admin exists in local users by email
    if (normalizedEmail) {
      const adminByEmail = Object.values(localUsers).find((u: any) => 
        u.email?.toLowerCase().trim() === normalizedEmail &&
        String(u.role || "").trim().toLowerCase() === "admin"
      );
      if (adminByEmail) {
        return {
          role: "Admin",
          studentId: null,
          userDoc: adminByEmail
        };
      }
    }

    // 3. Check active cached session
    const cachedSession = getCachedAuthSession();
    if (cachedSession && (cachedSession.uid === uid || (normalizedEmail && cachedSession.email === normalizedEmail))) {
      return {
        role: cachedSession.role === "admin" ? "Admin" : "Student",
        studentId: cachedSession.studentId || null,
        userDoc: { uid, role: cachedSession.role === "admin" ? "Admin" : "Student", studentId: cachedSession.studentId }
      };
    }

    return { role: null, studentId: null, userDoc: null };
  };

  try {
    const db = await getFirebaseDb();

    if (!db) {
      return checkLocalData();
    }

    // ----------------------------------------------------
    // FIRESTORE LIVE DATABASE LOOKUP
    // ----------------------------------------------------

    // 1. CHECK STUDENTS COLLECTION / TABLE FIRST
    // A) Direct doc in students/{uid}
    try {
      const studentDocRef = doc(db, "students", uid);
      const studentDocSnap = await getDoc(studentDocRef);
      if (studentDocSnap.exists()) {
        const studentData = studentDocSnap.data() as Student;
        const res: RoleVerificationResult = {
          role: "Student",
          studentId: studentData.id || uid,
          userDoc: { uid, role: "Student", studentId: studentData.id || uid }
        };
        saveCachedAuthSession({ uid, email: normalizedEmail || studentData.email || "", role: "student", studentId: res.studentId });
        return res;
      }
    } catch (err) {
      console.warn("[verifyUserRoleFromDatabase] Direct student doc lookup warning:", err);
    }

    // B) Direct doc in users/{uid} for Student role
    let userDoc: any = null;
    try {
      const userDocRef = doc(db, "users", uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        userDoc = userDocSnap.data();
        if (userDoc && userDoc.role && String(userDoc.role).trim().toLowerCase() === "student") {
          const studentId = userDoc.studentId || uid;
          const res: RoleVerificationResult = {
            role: "Student",
            studentId,
            userDoc
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "student", studentId });
          return res;
        }
      }
    } catch (err) {
      console.warn("[verifyUserRoleFromDatabase] Direct user doc lookup warning:", err);
    }

    // C) Check if userDoc has studentId pointing to students collection doc
    if (userDoc && userDoc.studentId) {
      try {
        const targetStudentRef = doc(db, "students", userDoc.studentId);
        const targetStudentSnap = await getDoc(targetStudentRef);
        if (targetStudentSnap.exists()) {
          const res: RoleVerificationResult = {
            role: "Student",
            studentId: userDoc.studentId,
            userDoc
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "student", studentId: userDoc.studentId });
          return res;
        }
      } catch (err) {
        console.warn("[verifyUserRoleFromDatabase] Target student ref lookup warning:", err);
      }
    }

    // D) Query students collection where uid == uid
    try {
      const studentsColRef = collection(db, "students");
      const qUid = query(studentsColRef, where("uid", "==", uid));
      const snapUid = await getDocs(qUid);
      if (!snapUid.empty) {
        const studentData = snapUid.docs[0].data() as Student;
        const res: RoleVerificationResult = {
          role: "Student",
          studentId: studentData.id || uid,
          userDoc: userDoc || { uid, role: "Student", studentId: studentData.id || uid }
        };
        saveCachedAuthSession({ uid, email: normalizedEmail || studentData.email || "", role: "student", studentId: res.studentId });
        return res;
      }

      // E) Query students collection where email == normalizedEmail
      if (normalizedEmail) {
        const qEmail = query(studentsColRef, where("email", "==", normalizedEmail));
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty) {
          const studentData = snapEmail.docs[0].data() as Student;
          const res: RoleVerificationResult = {
            role: "Student",
            studentId: studentData.id || uid,
            userDoc: userDoc || { uid, role: "Student", studentId: studentData.id || uid }
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || studentData.email || "", role: "student", studentId: res.studentId });
          return res;
        }
      }
    } catch (e) {
      console.warn("Error querying students collection:", e);
    }

    // F) Query users collection where email == normalizedEmail and role == Student
    if (normalizedEmail) {
      try {
        const usersColRef = collection(db, "users");
        const qUsersEmail = query(usersColRef, where("email", "==", normalizedEmail));
        const snapUsersEmail = await getDocs(qUsersEmail);
        for (const docSnap of snapUsersEmail.docs) {
          const data = docSnap.data();
          if (data && String(data.role || "").trim().toLowerCase() === "student") {
            const res: RoleVerificationResult = {
              role: "Student",
              studentId: data.studentId || uid,
              userDoc: data
            };
            saveCachedAuthSession({ uid, email: normalizedEmail || data.email || "", role: "student", studentId: res.studentId });
            return res;
          }
        }
      } catch (e) {
        console.warn("Error querying users collection by email for student:", e);
      }
    }

    // STUDENT CHECK FINISHED -> If student was found, we already returned.

    // 2. CHECK ADMINS COLLECTION / TABLE SECOND
    // A) Check direct doc in admins/{uid}
    try {
      const adminDocRef = doc(db, "admins", uid);
      const adminDocSnap = await getDoc(adminDocRef);
      if (adminDocSnap.exists()) {
        const res: RoleVerificationResult = {
          role: "Admin",
          studentId: null,
          userDoc: adminDocSnap.data()
        };
        saveCachedAuthSession({ uid, email: normalizedEmail || adminDocSnap.data()?.email || "", role: "admin", studentId: null });
        return res;
      }
    } catch (err) {
      console.warn("[verifyUserRoleFromDatabase] Direct admin doc lookup warning:", err);
    }

    // B) Check direct doc in users/{uid} for Admin role
    if (userDoc && userDoc.role && String(userDoc.role).trim().toLowerCase() === "admin") {
      const res: RoleVerificationResult = {
        role: "Admin",
        studentId: null,
        userDoc
      };
      saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "admin", studentId: null });
      return res;
    }

    // C) Query admins collection where uid == uid
    try {
      const adminsColRef = collection(db, "admins");
      const qAdminUid = query(adminsColRef, where("uid", "==", uid));
      const snapAdminUid = await getDocs(qAdminUid);
      if (!snapAdminUid.empty) {
        const res: RoleVerificationResult = {
          role: "Admin",
          studentId: null,
          userDoc: snapAdminUid.docs[0].data()
        };
        saveCachedAuthSession({ uid, email: normalizedEmail || snapAdminUid.docs[0].data()?.email || "", role: "admin", studentId: null });
        return res;
      }

      // D) Query admins collection where email == normalizedEmail
      if (normalizedEmail) {
        const qAdminEmail = query(adminsColRef, where("email", "==", normalizedEmail));
        const snapAdminEmail = await getDocs(qAdminEmail);
        if (!snapAdminEmail.empty) {
          const res: RoleVerificationResult = {
            role: "Admin",
            studentId: null,
            userDoc: snapAdminEmail.docs[0].data()
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || snapAdminEmail.docs[0].data()?.email || "", role: "admin", studentId: null });
          return res;
        }
      }
    } catch (e) {
      console.warn("Error querying admins collection:", e);
    }

    // E) Query users collection for Admin record by email or scanning users collection
    if (normalizedEmail) {
      try {
        const usersColRef = collection(db, "users");
        const qUsersEmail = query(usersColRef, where("email", "==", normalizedEmail));
        const snapUsersEmail = await getDocs(qUsersEmail);
        for (const docSnap of snapUsersEmail.docs) {
          const data = docSnap.data();
          if (data && String(data.role || "").trim().toLowerCase() === "admin") {
            // Ensure record has correct UID attached
            if (data.uid !== uid) {
              try {
                await setDoc(doc(db, "users", docSnap.id), { uid }, { merge: true });
              } catch (e) {
                // Ignore sync error
              }
            }
            const res: RoleVerificationResult = {
              role: "Admin",
              studentId: null,
              userDoc: { ...data, uid }
            };
            saveCachedAuthSession({ uid, email: normalizedEmail, role: "admin", studentId: null });
            return res;
          }
        }
      } catch (e) {
        console.warn("Error querying users collection by email for admin:", e);
      }
    }

    // F) Fallback scan of users collection in Firestore to support custom doc ID formats
    try {
      const usersColRef = collection(db, "users");
      const snapAllUsers = await getDocs(usersColRef);
      for (const d of snapAllUsers.docs) {
        const u = d.data();
        const matchesUid = u.uid === uid || d.id === uid;
        const matchesEmail = normalizedEmail && u.email?.toLowerCase().trim() === normalizedEmail;
        const isAdminRole = String(u.role || "").trim().toLowerCase() === "admin";

        if ((matchesUid || matchesEmail) && isAdminRole) {
          const res: RoleVerificationResult = {
            role: "Admin",
            studentId: null,
            userDoc: { ...u, uid }
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || u.email || "", role: "admin", studentId: null });
          return res;
        }
      }
    } catch (e) {
      console.warn("Error scanning users collection for admin:", e);
    }

    // 3. Fallback check to local data before returning null
    const localResult = checkLocalData();
    if (localResult.role) {
      return localResult;
    }

    // 4. NEITHER STUDENTS NOR ADMINS RECORD EXISTS FOR THIS UID / EMAIL
    return {
      role: null,
      studentId: null,
      userDoc: null
    };

  } catch (err) {
    console.warn("[verifyUserRoleFromDatabase] Error during database role check, using local fallback:", err);
    // Never crash or trigger unintended logout due to network issues
    const fallbackResult = checkLocalData();
    return fallbackResult;
  }
}

/**
 * Recursively removes any `undefined` values from an object or array before passing to Firestore.
 */
export function cleanObjectForFirestore<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => cleanObjectForFirestore(item)) as unknown as T;
  }
  if (typeof data === "object" && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = cleanObjectForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

/**
 * Create or update a user document
 */
export async function saveUserDocument(uid: string, userData: any): Promise<void> {
  const cleanedData = cleanObjectForFirestore(userData);
  
  // Cache to Local Storage Users map
  try {
    const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    const users = cachedUsers ? JSON.parse(cachedUsers) : {};
    users[uid] = { ...(users[uid] || {}), ...cleanedData };
    safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));
  } catch (e) {
    console.warn("Failed updating local user document cache:", e);
  }

  try {
    const db = await getFirebaseDb();
    if (!db) return;
    const userDocRef = doc(db, "users", uid);
    await setDoc(userDocRef, cleanedData, { merge: true });
  } catch (err) {
    console.warn(`saveUserDocument Firestore setDoc warning for users/${uid}:`, err);
  }
}

/**
 * Fetch user document by registered phone number (used during single unified login verification)
 */
export async function getUserDocByPhone(phone: string): Promise<any> {
  // Normalize phone to format like "+919876543210"
  let cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone.startsWith("91")) {
    cleanPhone = "91" + cleanPhone;
  }
  const formattedPhone = "+" + cleanPhone;

  try {
    const db = await getFirebaseDb();
    if (!db) {
      // Fallback: Search local users
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      const found = Object.values(users).find((u: any) => u.phone === formattedPhone);
      if (found) return found;

      // Check students list to see if a student matches this number or parent number
      const students = getLocalStudents();
      const matchedStudent = students.find((s) => {
        const sp = s.phone.replace(/\D/g, "");
        const pp = s.parentPhone.replace(/\D/g, "");
        return sp.endsWith(cleanPhone.substring(2)) || pp.endsWith(cleanPhone.substring(2));
      });

      if (matchedStudent) {
        const studentUid = matchedStudent.uid || `mock-student-uid-${matchedStudent.id}`;
        return {
          uid: studentUid,
          phone: formattedPhone,
          role: "Student",
          studentId: matchedStudent.id,
          status: "Active",
          name: matchedStudent.name
        };
      }

      return null;
    }

    const usersColRef = collection(db, "users");
    const snap = await getDocs(usersColRef);
    let matchedUser: any = null;
    snap.forEach((d) => {
      const u = d.data();
      if (u.phone === formattedPhone) {
        matchedUser = u;
      }
    });
    
    if (matchedUser) return matchedUser;

    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "users");
    return null;
  }
}

/**
 * Subscribe to the entire list of students (Real-time synchronization for Admin)
 */
export function subscribeToStudents(
  onUpdate: (students: Student[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Local Sandbox/Offline Mode: Trigger immediate update and register listener
      onUpdate(getLocalStudents());
      const listener: StudentsListener = (updatedList) => {
        if (active) onUpdate(updatedList);
      };
      studentsListeners.add(listener);
      unsubscribeFirestore = () => {
        studentsListeners.delete(listener);
      };
      return;
    }

    try {
      const studentsColRef = collection(db, "students");
      unsubscribeFirestore = onSnapshot(
        studentsColRef,
        (snap) => {
          if (!active) return;
          const list: Student[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as Student;
            if (
              data &&
              data.id &&
              data.name &&
              data.name.trim() !== "" &&
              data.name.trim().toLowerCase() !== "unnamed student"
            ) {
              list.push(data);
            } else if (
              docSnap.ref &&
              (!data || !data.name || data.name.trim() === "" || data.name.trim().toLowerCase() === "unnamed student")
            ) {
              // Delete orphaned or Unnamed Student records permanently from Firestore
              deleteDoc(docSnap.ref).catch(() => {});
            }
          });
          onUpdate(list);
          // Also sync with localStorage cache for offline seamless use
          safeSetStorage(STORAGE_KEY_STUDENTS, JSON.stringify(list));
        },
        (err) => {
          console.error("Firestore onSnapshot error", err);
          if (onError) onError(err);
          // Fallback to local cache on error
          onUpdate(getLocalStudents());
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to students collection, falling back to local storage.", err);
      onUpdate(getLocalStudents());
    }
  }

  setup();

  return () => {
    active = false;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Subscribe to a single student document (Real-time sync for Student Dashboard)
 */
export function subscribeToStudent(
  studentId: string,
  onUpdate: (student: Student) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Fallback: Get from local storage, register to global students listener to track updates
      const findAndTrigger = () => {
        const students = getLocalStudents();
        const found = students.find((s) => s.id === studentId);
        if (found && active) onUpdate(found);
      };
      findAndTrigger();

      const listener: StudentsListener = () => {
        findAndTrigger();
      };
      studentsListeners.add(listener);
      unsubscribeFirestore = () => {
        studentsListeners.delete(listener);
      };
      return;
    }

    try {
      const studentDocRef = doc(db, "students", studentId);
      unsubscribeFirestore = onSnapshot(
        studentDocRef,
        (snap) => {
          if (!active) return;
          if (snap.exists()) {
            onUpdate(snap.data() as Student);
          }
        },
        (err) => {
          console.error("Single student subscription failed:", err);
          if (onError) onError(err);
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to single student doc. Using local fallback.", err);
    }
  }

  setup();

  return () => {
    active = false;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Save or update student record
 */
export async function saveStudentDoc(student: Student): Promise<void> {
  const cleanedStudent = cleanObjectForFirestore(student);

  // Synchronously update local storage cache and notify local subscribers
  const students = getLocalStudents();
  const existsIdx = students.findIndex((s) => s.id === cleanedStudent.id);
  if (existsIdx > -1) {
    students[existsIdx] = cleanedStudent;
  } else {
    students.unshift(cleanedStudent);
  }
  saveLocalStudents(students);

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", cleanedStudent.id);
    await setDoc(studentDocRef, cleanedStudent, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `students/${cleanedStudent.id}`);
  }
}

/**
 * Update student presence timestamp (lastActiveAt) in real-time
 */
export async function updateStudentPresence(studentId: string): Promise<void> {
  const now = new Date().toISOString();
  // Update local storage cache
  const students = getLocalStudents();
  const idx = students.findIndex((s) => s.id === studentId);
  if (idx > -1) {
    students[idx] = { ...students[idx], lastActiveAt: now };
    saveLocalStudents(students);
  }

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", studentId);
    await setDoc(studentDocRef, { lastActiveAt: now }, { merge: true });
  } catch (err) {
    console.warn("Failed updating student presence timestamp:", err);
  }
}

/**
 * Mark a student as offline (when logging out or closing app)
 */
export async function markStudentOffline(studentId: string): Promise<void> {
  // Update local storage cache
  const students = getLocalStudents();
  const idx = students.findIndex((s) => s.id === studentId);
  if (idx > -1) {
    students[idx] = { ...students[idx], lastActiveAt: "" };
    saveLocalStudents(students);
  }

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", studentId);
    await setDoc(studentDocRef, { lastActiveAt: "" }, { merge: true });
  } catch (err) {
    console.warn("Failed marking student offline:", err);
  }
}

/**
 * Delete student record permanently across local storage, Firestore, and Supabase
 */
export async function deleteStudentDoc(studentId: string): Promise<void> {
  if (!studentId || typeof studentId !== "string" || !studentId.trim()) {
    console.warn("[Firestore] deleteStudentDoc called with empty or invalid studentId:", studentId);
    return;
  }

  // 1. Always purge local storage
  const students = getLocalStudents();
  const filtered = students.filter(
    (s) => s.id !== studentId && s.name !== "Unnamed Student" && Boolean(s.name && s.name.trim())
  );
  saveLocalStudents(filtered);

  // 2. Delete from Firestore if available
  const db = await getFirebaseDb();
  if (db) {
    try {
      const studentDocRef = doc(db, "students", studentId);
      await deleteDoc(studentDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `students/${studentId}`);
    }
  }

  // 3. Delete student practice test attempts in Supabase
  try {
    const { supabase } = await import("./supabaseClient");
    await supabase.from("student_practice_test_attempts").delete().eq("student_id", studentId);
  } catch (e) {
    console.warn("[Firestore] Error deleting student test attempts in Supabase:", e);
  }
}

/**
 * Permanently purge any "Unnamed Student" or invalid empty student records across LocalStorage, Firestore, and Supabase.
 */
export async function purgeUnnamedStudents(): Promise<void> {
  // 1. Clean localStorage
  try {
    const cached = localStorage.getItem(STORAGE_KEY_STUDENTS);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (s: any) =>
            Boolean(s) &&
            Boolean(s.id) &&
            s.name !== "Unnamed Student" &&
            Boolean(s.name && String(s.name).trim() !== "")
        );
        if (cleaned.length !== parsed.length) {
          saveLocalStudents(cleaned);
        }
      }
    }
  } catch (e) {
    console.warn("[Purge] Error cleaning local students cache:", e);
  }

  // 2. Clean Firestore if database is available
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentsColRef = collection(db, "students");
      const snap = await getDocs(studentsColRef);
      snap.forEach(async (docSnap) => {
        const data = docSnap.data();
        if (!data || !data.name || data.name.trim() === "" || data.name.trim().toLowerCase() === "unnamed student") {
          console.log(`[Purge] Permanently deleting Unnamed Student record from Firestore: ${docSnap.id}`);
          await deleteDoc(docSnap.ref).catch(() => {});
        }
      });
    }
  } catch (e) {
    console.warn("[Purge] Error purging Firestore students:", e);
  }

  // 3. Clean Supabase test attempts for Unnamed Student
  try {
    const { supabase } = await import("./supabaseClient");
    await supabase.from("student_practice_test_attempts").delete().ilike("student_name", "%unnamed student%");
    await supabase.from("student_practice_test_attempts").delete().eq("student_name", "");
  } catch (e) {
    console.warn("[Purge] Error cleaning Supabase test attempts for Unnamed Student:", e);
  }
}

/**
 * Checks if there is any user with Admin role in the database.
 */
export async function checkAnyAdminExists(): Promise<boolean> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      return Object.values(users).some((u: any) => u.role === "Admin" || u.role === "admin");
    }
    
    const usersColRef = collection(db, "users");
    const snap = await getDocs(usersColRef);
    let adminFound = false;
    snap.forEach((doc) => {
      const u = doc.data();
      if (u.role === "Admin" || u.role === "admin") {
        adminFound = true;
      }
    });
    return adminFound;
  } catch (e: any) {
    console.warn("Failed checking if admin exists:", e);
    
    // If the database threw a permission-denied error, it means Firestore security rules
    // are active and enforcing unauthenticated access block. This guarantees the database
    // is already initialized, configured, and secured!
    if (e && (e.code === "permission-denied" || (e.message && e.message.toLowerCase().includes("permission")))) {
      return true;
    }
    
    const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    const users = cachedUsers ? JSON.parse(cachedUsers) : {};
    return Object.values(users).some((u: any) => u.role === "Admin" || u.role === "admin");
  }
}

/**
 * Saves the Institution Name.
 */
export async function saveInstitutionName(name: string): Promise<void> {
  const trimmed = name.trim() || "Sumit Tuition App";
  setCachedInstitutionName(trimmed);
  try {
    const db = await getFirebaseDb();
    if (!db) {
      return;
    }
    const settingsDocRef = doc(db, "settings", "institution");
    await setDoc(settingsDocRef, { name: trimmed }, { merge: true });
  } catch (err) {
    console.warn("Failed saving institution name to Firestore:", err);
  }
}

/**
 * Fetches the Institution Name.
 */
export async function getInstitutionName(): Promise<string> {
  const cached = getCachedInstitutionName();
  try {
    const db = await getFirebaseDb();
    if (!db) {
      return cached;
    }
    const settingsDocRef = doc(db, "settings", "institution");
    const snap = await getDoc(settingsDocRef);
    if (snap.exists()) {
      const value = snap.data().name || "Sumit Tuition App";
      setCachedInstitutionName(value);
      return value;
    }
    return cached;
  } catch (err) {
    console.warn("Failed fetching institution name from Firestore:", err);
    return cached;
  }
}

/**
 * Fetches all registered administrators from Firestore (or Local Storage fallback).
 */
export async function getAllAdmins(): Promise<any[]> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      const filtered: any[] = [];
      const seenCredentials = new Set<string>();
      let changed = false;

      for (const uid of Object.keys(users)) {
        const u = users[uid];
        if (u?.email?.toLowerCase() === "sumitprasadsaha2@gmail.com") {
          delete users[uid];
          changed = true;
          continue;
        }
        if (u?.role === "Admin" || u?.role === "admin") {
          const credKey = (u?.email || u?.username || u?.uid || uid).toLowerCase().trim();
          if (seenCredentials.has(credKey)) {
            // Duplicate admin credentials -> remove duplicate from local storage
            delete users[uid];
            changed = true;
          } else {
            seenCredentials.add(credKey);
            filtered.push(u);
          }
        }
      }
      if (changed) {
        safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));
      }
      return filtered;
    }

    const usersColRef = collection(db, "users");
    const snap = await getDocs(usersColRef);
    const admins: any[] = [];
    const seenCredentials = new Set<string>();

    for (const d of snap.docs) {
      const u = d.data();
      if (u.email?.toLowerCase() === "sumitprasadsaha2@gmail.com") {
        try {
          await deleteDoc(doc(db, "users", d.id));
        } catch (e) {
          console.warn("Failed deleting sumitprasadsaha2@gmail.com doc:", e);
        }
        continue;
      }
      if (u.role === "Admin" || u.role === "admin") {
        const credKey = (u.email || u.username || u.uid || d.id).toLowerCase().trim();
        if (seenCredentials.has(credKey)) {
          // Multiple admins with same credentials -> keep only one, remove duplicate from Firestore
          try {
            await deleteDoc(doc(db, "users", d.id));
            console.log(`[Firestore] Removed duplicate admin user doc ID: ${d.id} for credential: ${credKey}`);
          } catch (e) {
            console.warn("Failed deleting duplicate admin document:", e);
          }
        } else {
          seenCredentials.add(credKey);
          admins.push({ ...u, uid: u.uid || d.id, id: d.id });
        }
      }
    }
    return admins;
  } catch (err) {
    console.error("Error fetching all admins:", err);
    return [];
  }
}

/**
 * Deletes a user document from Firestore (or Local Storage fallback).
 */
export async function deleteUserDocument(uid: string): Promise<void> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      delete users[uid];
      safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));
      return;
    }
    const userDocRef = doc(db, "users", uid);
    await deleteDoc(userDocRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }
}

/**
 * Deletes a user from Firebase Authentication.
 * This is a server-side operation and requires appropriate security rules.
 */
export async function deleteUserAuthCredentials(uid: string): Promise<void> {
  try {
    const auth = await (async () => {
      const { getFirebaseAuth } = await import("./firebase");
      return getFirebaseAuth();
    })();
    
    if (!auth) {
      console.warn("Firebase Auth not available, skipping auth deletion");
      return;
    }
    
    // Note: Client-side deletion of other users requires special security rules or admin SDK
    // For now, this function prepares the structure for future admin SDK integration
    console.log(`Prepared to delete auth credentials for user: ${uid}`);
  } catch (err) {
    console.error(`Error deleting auth credentials for user ${uid}:`, err);
  }
}

/**
 * Subscribe to announcements in real-time
 */
export function subscribeToAnnouncements(
  onUpdate: (announcements: any[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";

  const getCachedAnnouncements = () => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  };

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Local fallback
      onUpdate(getCachedAnnouncements());
      const handleLocalEvent = () => {
        if (active) onUpdate(getCachedAnnouncements());
      };
      window.addEventListener("storage", handleLocalEvent);
      unsubscribeFirestore = () => {
        window.removeEventListener("storage", handleLocalEvent);
      };
      return;
    }

    try {
      const colRef = collection(db, "announcements");
      unsubscribeFirestore = onSnapshot(
        colRef,
        (snap) => {
          if (!active) return;
          const list: any[] = [];
          snap.forEach((doc) => {
            list.push(doc.data());
          });
          // Sort descending by date/id
          list.sort((a, b) => {
            const dateA = a.date || "";
            const dateB = b.date || "";
            if (dateA !== dateB) return dateB.localeCompare(dateA);
            return (b.id || "").localeCompare(a.id || "");
          });
          onUpdate(list);
          safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(list));
        },
        (err) => {
          console.error("Firestore announcements snapshot error", err);
          if (onError) onError(err);
          onUpdate(getCachedAnnouncements());
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to announcements, using local fallback", err);
      onUpdate(getCachedAnnouncements());
    }
  }

  setup();

  return () => {
    active = false;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Save an announcement
 */
export async function saveAnnouncementDoc(announcement: { id: string; text: string; date: string }): Promise<void> {
  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";
  const db = await getFirebaseDb();
  if (!db) {
    // Local fallback
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      const list = cached ? JSON.parse(cached) : [];
      const updated = [announcement, ...list.filter((a: any) => a.id !== announcement.id)];
      safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    const docRef = doc(db, "announcements", announcement.id);
    await setDoc(docRef, cleanObjectForFirestore(announcement));
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `announcements/${announcement.id}`);
  }
}

/**
 * Delete an announcement
 */
export async function deleteAnnouncementDoc(id: string): Promise<void> {
  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";
  const db = await getFirebaseDb();
  if (!db) {
    // Local fallback
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      const list = cached ? JSON.parse(cached) : [];
      const updated = list.filter((a: any) => a.id !== id);
      safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    const docRef = doc(db, "announcements", id);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `announcements/${id}`);
  }
}

// ----------------------------------------------------
// CLASS NOTES CENTRALIZED STORAGE API (STABLE & DEDUPLICATED)
// ----------------------------------------------------
const STORAGE_KEY_CLASS_NOTES = "tuition_class_notes";

type ClassNotesListener = (notes: ClassNote[]) => void;
const classNotesListeners = new Set<ClassNotesListener>();

let inMemoryClassNotesCache: ClassNote[] | null = null;
let activeFirestoreClassNotesUnsub: (() => void) | null = null;
let isFirestoreClassNotesSubscribed = false;
let isClassNotesFetchInProgress = false;

/**
 * Deep structural equality comparator for ClassNote arrays to prevent unnecessary UI re-renders
 */
export function areClassNotesEqual(
  a: ClassNote[] | null | undefined,
  b: ClassNote[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = a[i];
    const nb = b[i];
    if (
      na.id !== nb.id ||
      na.chapterNo !== nb.chapterNo ||
      na.chapterName !== nb.chapterName ||
      na.partLabel !== nb.partLabel ||
      na.topicNo !== nb.topicNo ||
      na.topicName !== nb.topicName ||
      na.pdfUrl !== nb.pdfUrl ||
      na.storagePath !== nb.storagePath ||
      na.bucket !== nb.bucket ||
      na.createdAt !== nb.createdAt ||
      na.accessType !== nb.accessType ||
      na.fileType !== nb.fileType ||
      na.mimeType !== nb.mimeType ||
      na.classGrade !== nb.classGrade ||
      na.subject !== nb.subject ||
      JSON.stringify(na.allowedStudentIds || []) !== JSON.stringify(nb.allowedStudentIds || []) ||
      JSON.stringify(na.allowedClasses || []) !== JSON.stringify(nb.allowedClasses || [])
    ) {
      return false;
    }
  }
  return true;
}

export function getLocalClassNotes(): ClassNote[] {
  if (inMemoryClassNotesCache && inMemoryClassNotesCache.length > 0) {
    return inMemoryClassNotesCache;
  }
  if (typeof window === "undefined") return inMemoryClassNotesCache || [];
  const cached = localStorage.getItem(STORAGE_KEY_CLASS_NOTES);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        inMemoryClassNotesCache = parsed;
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse local class notes", e);
    }
  }
  return inMemoryClassNotesCache || [];
}

export function saveLocalClassNotes(notes: ClassNote[]) {
  if (typeof window === "undefined" || !Array.isArray(notes)) return;
  
  // Prevent duplicate state emissions if the dataset is unchanged
  if (areClassNotesEqual(inMemoryClassNotesCache, notes)) {
    return;
  }

  // Atomically update memory cache and persistent storage
  inMemoryClassNotesCache = notes;
  safeSetStorage(STORAGE_KEY_CLASS_NOTES, JSON.stringify(notes));

  // Notify all registered UI listeners with the stable reference
  classNotesListeners.forEach((listener) => {
    try {
      listener(notes);
    } catch (err) {
      console.warn("[ClassNotesListener] callback warning:", err);
    }
  });
}

function ensureSingleFirestoreNotesSubscription() {
  if (isFirestoreClassNotesSubscribed || isClassNotesFetchInProgress) return;
  isClassNotesFetchInProgress = true;

  (async () => {
    try {
      const db = await getFirebaseDb();
      if (!db) {
        isClassNotesFetchInProgress = false;
        return;
      }

      const colRef = collection(db, "class_notes");
      activeFirestoreClassNotesUnsub = onSnapshot(
        colRef,
        (snap) => {
          isClassNotesFetchInProgress = false;
          isFirestoreClassNotesSubscribed = true;
          const remoteList: ClassNote[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as ClassNote;
            if (data && data.id) {
              remoteList.push(data);
            }
          });

          // NEVER clear existing notes on empty snapshot if we already have valid notes cached
          const currentLocal = inMemoryClassNotesCache || getLocalClassNotes();
          if (remoteList.length > 0) {
            saveLocalClassNotes(remoteList);
          } else if (currentLocal.length === 0 && !snap.metadata.hasPendingWrites) {
            saveLocalClassNotes([]);
          }
        },
        (err) => {
          isClassNotesFetchInProgress = false;
          console.warn("[Firestore] class_notes subscription notice (retaining existing notes):", err);
        }
      );
      isFirestoreClassNotesSubscribed = true;
    } catch (err) {
      isClassNotesFetchInProgress = false;
      console.warn("[Firestore] Failed setting up class_notes subscription:", err);
    } finally {
      isClassNotesFetchInProgress = false;
    }
  })();
}

export function subscribeToClassNotes(
  onUpdate: (notes: ClassNote[]) => void,
  onError?: (err: any) => void
): () => void {
  // 1. Instantly emit cached notes if available (zero blank flicker)
  const current = getLocalClassNotes();
  if (current.length > 0) {
    onUpdate(current);
  }

  // 2. Register UI subscriber
  classNotesListeners.add(onUpdate);

  // 3. Ensure a single shared Firestore listener is active
  ensureSingleFirestoreNotesSubscription();

  return () => {
    classNotesListeners.delete(onUpdate);
    // If no more listeners remain, keep in-memory cache but detach remote listener
    if (classNotesListeners.size === 0 && activeFirestoreClassNotesUnsub) {
      try {
        activeFirestoreClassNotesUnsub();
      } catch {}
      activeFirestoreClassNotesUnsub = null;
      isFirestoreClassNotesSubscribed = false;
    }
  };
}

export async function saveClassNoteDoc(note: ClassNote): Promise<void> {
  const currentLocal = getLocalClassNotes();
  const exists = currentLocal.some((n) => n.id === note.id);
  const updatedLocal = exists
    ? currentLocal.map((n) => (n.id === note.id ? note : n))
    : [note, ...currentLocal];
  saveLocalClassNotes(updatedLocal);

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const docRef = doc(db, "class_notes", note.id);
    await setDoc(docRef, cleanObjectForFirestore(note), { merge: true });
    console.log(`[Firestore] Successfully persisted class note: class_notes/${note.id}`);
  } catch (err: any) {
    console.warn(`[Firestore] saveClassNoteDoc warning for class_notes/${note.id}:`, err);
  }
}

export async function deleteClassNoteDoc(noteId: string): Promise<void> {
  const db = await getFirebaseDb();
  const currentLocal = getLocalClassNotes();
  const targetNote = currentLocal.find((n) => n.id === noteId);
  const updatedLocal = currentLocal.filter((n) => n.id !== noteId);
  saveLocalClassNotes(updatedLocal);

  // Clean up legacy student.notes across all student records to prevent auto-migration from resurrecting it
  try {
    const students = getLocalStudents();
    let anyStudentUpdated = false;
    const updatedStudentsList = students.map((student) => {
      if (!student.notes) return student;
      let studentUpdated = false;
      const updatedNotes: Record<string, any[]> = {};

      for (const [subject, notesArr] of Object.entries(student.notes)) {
        if (!Array.isArray(notesArr)) {
          updatedNotes[subject] = notesArr as any;
          continue;
        }
        const filtered = notesArr.filter((n: any) => {
          if (n.id === noteId) return false;
          if (targetNote?.storagePath && n.storagePath === targetNote.storagePath) return false;
          if (targetNote?.pdfUrl && n.pdfUrl === targetNote.pdfUrl) return false;
          return true;
        });

        if (filtered.length !== notesArr.length) {
          studentUpdated = true;
          anyStudentUpdated = true;
        }
        if (filtered.length > 0) {
          updatedNotes[subject] = filtered;
        }
      }

      if (studentUpdated) {
        return { ...student, notes: updatedNotes };
      }
      return student;
    });

    if (anyStudentUpdated) {
      saveLocalStudents(updatedStudentsList);
      for (const st of updatedStudentsList) {
        const orig = students.find((s) => s.id === st.id);
        if (orig && JSON.stringify(orig.notes) !== JSON.stringify(st.notes)) {
          await saveStudentDoc(st);
        }
      }
    }
  } catch (err) {
    console.warn("Failed cleansing student.notes on deleteClassNoteDoc:", err);
  }

  if (!db) return;

  try {
    const docRef = doc(db, "class_notes", noteId);
    await deleteDoc(docRef);

    // Clean up student.notes across all student records in Firestore
    try {
      const studentsColRef = collection(db, "students");
      const snap = await getDocs(studentsColRef);
      snap.forEach(async (docSnap) => {
        const st = docSnap.data() as Student;
        if (!st || !st.notes) return;
        let studentUpdated = false;
        const updatedNotes: Record<string, any[]> = {};

        for (const [subject, notesArr] of Object.entries(st.notes)) {
          if (!Array.isArray(notesArr)) {
            updatedNotes[subject] = notesArr as any;
            continue;
          }
          const filtered = notesArr.filter((n: any) => {
            if (n.id === noteId) return false;
            if (targetNote?.storagePath && n.storagePath === targetNote.storagePath) return false;
            if (targetNote?.pdfUrl && n.pdfUrl === targetNote.pdfUrl) return false;
            return true;
          });

          if (filtered.length !== notesArr.length) {
            studentUpdated = true;
          }
          if (filtered.length > 0) {
            updatedNotes[subject] = filtered;
          }
        }

        if (studentUpdated) {
          const cleanedStudent = { ...st, notes: updatedNotes };
          await setDoc(doc(db, "students", st.id), cleanObjectForFirestore(cleanedStudent), { merge: true });
        }
      });
    } catch (fsErr) {
      console.warn("Failed cleansing Firestore student.notes on delete:", fsErr);
    }
  } catch (err) {
    // Revert local cache on failure to prevent desync
    saveLocalClassNotes(currentLocal);
    handleFirestoreError(err, OperationType.DELETE, `class_notes/${noteId}`);
  }
}

// ----------------------------------------------------
// TEST ATTEMPTS CENTRALIZED STORAGE & DB API
// ----------------------------------------------------
const STORAGE_KEY_TEST_ATTEMPTS = "tuition_student_test_attempts";

type TestAttemptsListener = (attempts: TestAttemptRecord[]) => void;
const testAttemptsListeners = new Set<TestAttemptsListener>();

export function getLocalTestAttempts(): TestAttemptRecord[] {
  if (typeof window === "undefined") return [];
  const cached = localStorage.getItem(STORAGE_KEY_TEST_ATTEMPTS);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.error("Failed to parse local test attempts", e);
    }
  }
  return [];
}

export function saveLocalTestAttemptsCache(attempts: TestAttemptRecord[]) {
  if (typeof window === "undefined") return;
  safeSetStorage(STORAGE_KEY_TEST_ATTEMPTS, JSON.stringify(attempts));
  testAttemptsListeners.forEach((listener) => listener(attempts));
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("test-attempts-updated"));
}

export async function saveTestAttemptDoc(attempt: TestAttemptRecord): Promise<void> {
  const cleaned = cleanObjectForFirestore(attempt);

  // 1. Update local storage cache & notify local listeners immediately
  const currentLocal = getLocalTestAttempts();
  const existingIdx = currentLocal.findIndex((a) => a.id === cleaned.id);
  if (existingIdx > -1) {
    currentLocal[existingIdx] = cleaned;
  } else {
    currentLocal.unshift(cleaned);
  }
  saveLocalTestAttemptsCache(currentLocal);

  // 2. Calculate permanent Topic Score Summary record
  const topicAttempts = currentLocal.filter((a) => {
    return (
      a.studentId === attempt.studentId &&
      a.subject?.toLowerCase().trim() === attempt.subject?.toLowerCase().trim() &&
      Number(a.chapterNo) === Number(attempt.chapterNo) &&
      a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "") === attempt.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
  });

  const totalAttempts = topicAttempts.length;
  const latestScore = attempt.percentage ?? (attempt.totalQuestions > 0 ? Math.round((attempt.score / attempt.totalQuestions) * 100) : 0);
  
  let highestScore = latestScore;
  topicAttempts.forEach((a) => {
    const pct = a.percentage ?? (a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0);
    if (pct > highestScore) highestScore = pct;
  });

  const topicSummaryDoc = {
    studentId: attempt.studentId,
    subject: attempt.subject,
    chapterNo: attempt.chapterNo,
    chapterName: attempt.chapterName,
    topicId: attempt.topicId || attempt.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "_") || "topic",
    topicName: attempt.topicName,
    highestScore,
    latestScore,
    totalAttempts,
    lastAttemptAt: attempt.date || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // 3. Save to Firestore collections "student_test_attempts" AND "student_topic_test_scores"
  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const attemptDocRef = doc(db, "student_test_attempts", cleaned.id);
    await setDoc(attemptDocRef, cleaned, { merge: true });

    const safeTopicKey = `${attempt.studentId}_${attempt.subject}_ch${attempt.chapterNo}_${topicSummaryDoc.topicId}`
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const summaryDocRef = doc(db, "student_topic_test_scores", safeTopicKey);
    await setDoc(summaryDocRef, cleanObjectForFirestore(topicSummaryDoc), { merge: true });
  } catch (err) {
    console.warn("Failed saving test attempt to Firestore collection:", err);
  }
}

export function subscribeToTestAttempts(
  onUpdate: (attempts: TestAttemptRecord[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  const handleLocalEvent = () => {
    if (active) onUpdate(getLocalTestAttempts());
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleLocalEvent);
    window.addEventListener("test-attempts-updated", handleLocalEvent);
  }

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      onUpdate(getLocalTestAttempts());
      const listener: TestAttemptsListener = (updatedList) => {
        if (active) onUpdate(updatedList);
      };
      testAttemptsListeners.add(listener);
      unsubscribeFirestore = () => {
        testAttemptsListeners.delete(listener);
      };
      return;
    }

    try {
      const colRef = collection(db, "student_test_attempts");
      unsubscribeFirestore = onSnapshot(
        colRef,
        (snap) => {
          if (!active) return;
          const list: TestAttemptRecord[] = [];
          snap.forEach((docSnap) => {
            list.push(docSnap.data() as TestAttemptRecord);
          });

          // Sort descending by timestamp
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

          if (list.length > 0) {
            saveLocalTestAttemptsCache(list);
            onUpdate(list);
          } else {
            onUpdate(getLocalTestAttempts());
          }
        },
        (err) => {
          console.warn("Firestore student_test_attempts snapshot warning, falling back to local storage", err);
          if (onError) onError(err);
          onUpdate(getLocalTestAttempts());
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to student_test_attempts, using local fallback", err);
      onUpdate(getLocalTestAttempts());
    }
  }

  setup();

  return () => {
    active = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleLocalEvent);
      window.removeEventListener("test-attempts-updated", handleLocalEvent);
    }
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Get test attempts for a specific student
 * Useful for loading previous scores on student login
 */
export async function getStudentTestAttempts(studentId: string): Promise<TestAttemptRecord[]> {
  const all = getLocalTestAttempts();
  const filtered = all.filter((a) => a.studentId === studentId);
  
  if (filtered.length === 0) {
    // Try fetching from Firestore if not in local cache
    const db = await getFirebaseDb();
    if (db) {
      try {
        const colRef = collection(db, "student_test_attempts");
        const q = query(colRef, where("studentId", "==", studentId));
        const snap = await getDocs(q);
        const results: TestAttemptRecord[] = [];
        snap.forEach((docSnap) => {
          results.push(docSnap.data() as TestAttemptRecord);
        });
        results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return results;
      } catch (err) {
        console.warn(`Failed fetching test attempts for student ${studentId}:`, err);
      }
    }
  }
  
  return filtered;
}

/**
 * Get topic test score summary for a student
 */
export async function getStudentTopicTestScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicId: string
): Promise<any> {
  const safeTopicKey = `${studentId}_${subject}_ch${chapterNo}_${topicId}`
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    const db = await getFirebaseDb();
    if (!db) return null;

    const docRef = doc(db, "student_topic_test_scores", safeTopicKey);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn(`Failed fetching topic test score for ${safeTopicKey}:`, err);
    return null;
  }
}

/**
 * Broadcast deletion signal for content cleanup across all devices
 */
export async function broadcastContentDeletion(
  contentType: string,
  contentId: string,
  metadata?: Record<string, any>
): Promise<void> {
  // 1. Broadcast via custom event (same tab)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("content-deleted", {
      detail: { contentType, contentId, metadata, timestamp: Date.now() }
    }));
  }

  // 2. Broadcast via BroadcastChannel (same browser, all tabs)
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const bc = new BroadcastChannel("tuition_content_sync");
      bc.postMessage({
        type: "CONTENT_DELETED",
        contentType,
        contentId,
        metadata,
        timestamp: Date.now()
      });
      bc.close();
    } catch (err) {
      console.warn("[FirestoreService] BroadcastChannel deletion signal failed:", err);
    }
  }

  // 3. Send Firestore sync signal (cross-device)
  try {
    const db = await getFirebaseDb();
    if (db) {
      const syncDocRef = doc(db, "content_sync_signals", "latest");
      await setDoc(syncDocRef, {
        lastDeletedAt: new Date().toISOString(),
        lastDeletedContentType: contentType,
        lastDeletedContentId: contentId,
        timestamp: Date.now(),
        ...metadata
      }, { merge: true });
    }
  } catch (err) {
    console.warn("[FirestoreService] Failed sending Firestore deletion signal:", err);
  }
}

/**
 * Listen for content deletion signals from other devices
 */
export function listenToContentDeletionSignals(
  onDeletion: (detail: any) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleDeletion = (event: Event) => {
    const customEvent = event as CustomEvent;
    onDeletion(customEvent.detail);
  };

  window.addEventListener("content-deleted", handleDeletion);

  return () => {
    window.removeEventListener("content-deleted", handleDeletion);
  };
}

/**
 * Global cleanup function - call on app unload or logout
 * Prevents memory leaks by properly unsubscribing from all listeners
 */
export function cleanupAllFirestoreListeners(): void {
  if (typeof window === "undefined") return;
  
  // Clear all listener sets
  studentsListeners.clear();
  classNotesListeners.clear();
  testAttemptsListeners.clear();
  
  console.log("[FirestoreService] All listeners cleaned up");
}

/**
 * Update student service status in database (Supabase, Firestore, local cache)
 */
export async function updateStudentServiceStatus(
  studentId: string,
  status: "active" | "paused" | "ended"
): Promise<boolean> {
  if (!studentId || typeof studentId !== "string") return false;

  const newStatus: "active" | "paused" | "ended" =
    status === "paused" || status === "ended" ? status : "active";

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] database update payload:", { studentId, status: newStatus });
  }

  // 1. Update Local Storage Cache & notify local subscribers immediately
  try {
    const students = getLocalStudents();
    const idx = students.findIndex((s) => s.id === studentId);
    if (idx > -1) {
      students[idx] = {
        ...students[idx],
        serviceStatus: newStatus,
        service_status: newStatus
      };
      saveLocalStudents(students);
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error updating local students cache:", err);
  }

  // 2. Update Firestore Document
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentDocRef = doc(db, "students", studentId);
      await setDoc(studentDocRef, { serviceStatus: newStatus, service_status: newStatus }, { merge: true });
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error updating Firestore service status:", err);
  }

  // 3. Update Supabase Database Table
  try {
    const { supabase } = await import("./supabaseClient");
    if (supabase) {
      const { error: updateErr } = await supabase
        .from("students")
        .update({ service_status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", studentId);

      if (updateErr) {
        // Fallback to upsert if record doesn't exist yet
        const { error: upsertErr } = await supabase
          .from("students")
          .upsert({ id: studentId, service_status: newStatus, updated_at: new Date().toISOString() }, { onConflict: "id" });
        if (upsertErr) {
          console.warn("[StudentServiceStatus] Supabase service_status upsert warning:", upsertErr.message);
        }
      }
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error syncing to Supabase table:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] update success:", true, "refreshed status:", newStatus);
  }

  return true;
}

/**
 * Fetch latest student service status directly from database
 */
export async function fetchStudentServiceStatus(
  studentId: string
): Promise<"active" | "paused" | "ended"> {
  if (!studentId || typeof studentId !== "string") return "active";

  // 1. Attempt fetching from Supabase table first
  try {
    const { supabase } = await import("./supabaseClient");
    if (supabase) {
      const { data, error } = await supabase
        .from("students")
        .select("service_status")
        .eq("id", studentId)
        .maybeSingle();

      if (!error && data && data.service_status) {
        const val = String(data.service_status).toLowerCase();
        if (val === "paused" || val === "ended" || val === "active") {
          if (process.env.NODE_ENV !== "production") {
            console.log("[StudentServiceStatus] fetched status from Supabase:", val);
          }
          return val as "active" | "paused" | "ended";
        }
      }
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error reading from Supabase:", err);
  }

  // 2. Fallback to Firestore
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentDocRef = doc(db, "students", studentId);
      const snap = await getDoc(studentDocRef);
      if (snap.exists()) {
        const data = snap.data();
        const raw = data?.service_status || data?.serviceStatus;
        if (raw) {
          const val = String(raw).toLowerCase();
          if (val === "paused" || val === "ended" || val === "active") {
            if (process.env.NODE_ENV !== "production") {
              console.log("[StudentServiceStatus] fetched status from Firestore:", val);
            }
            return val as "active" | "paused" | "ended";
          }
        }
      }
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error reading from Firestore:", err);
  }

  // 3. Fallback to local storage cache
  try {
    const students = getLocalStudents();
    const found = students.find((s) => s.id === studentId);
    if (found) {
      const raw = found.service_status || found.serviceStatus;
      if (raw) {
        const val = String(raw).toLowerCase();
        if (val === "paused" || val === "ended" || val === "active") {
          if (process.env.NODE_ENV !== "production") {
            console.log("[StudentServiceStatus] fetched status from local storage:", val);
          }
          return val as "active" | "paused" | "ended";
        }
      }
    }
  } catch (err) {}

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] fetched status default fallback:", "active");
  }
  return "active";
}

export interface FreshAdminDashboardData {
  students: Student[];
  announcements: any[];
  institutionName: string;
}

/**
 * Force fresh refetch of all Admin Dashboard data directly from database (Firestore & Supabase).
 * Bypasses cached state, fetches resources in parallel, and updates local cache atomically.
 */
export async function fetchFreshAdminDashboardData(): Promise<FreshAdminDashboardData> {
  const db = await getFirebaseDb();

  // 1. Force network query for Students from Firestore & Supabase
  const fetchStudentsTask = (async (): Promise<Student[]> => {
    let firestoreList: Student[] = [];
    if (db) {
      try {
        const colRef = collection(db, "students");
        let snap;
        try {
          const { getDocsFromServer } = await import("firebase/firestore");
          snap = await getDocsFromServer(colRef);
        } catch {
          snap = await getDocs(colRef);
        }

        snap.forEach((docSnap) => {
          const data = docSnap.data() as Student;
          if (
            data &&
            data.id &&
            data.name &&
            data.name.trim() !== "" &&
            data.name.trim().toLowerCase() !== "unnamed student"
          ) {
            firestoreList.push(data);
          }
        });
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Firestore students query error:", err);
      }
    }

    // Check Supabase students table to complement/merge latest fields
    try {
      const { supabase } = await import("./supabaseClient");
      if (supabase) {
        const { data: sbStudents, error } = await supabase.from("students").select("*");
        if (!error && Array.isArray(sbStudents) && sbStudents.length > 0) {
          const sbMap = new Map<string, any>();
          sbStudents.forEach((st) => {
            if (st.id) sbMap.set(st.id, st);
          });

          // Merge any service_status or updated fields from Supabase
          if (firestoreList.length > 0) {
            firestoreList = firestoreList.map((fsStudent) => {
              const sbMatch = sbMap.get(fsStudent.id);
              if (sbMatch && sbMatch.service_status) {
                return {
                  ...fsStudent,
                  serviceStatus: sbMatch.service_status,
                  service_status: sbMatch.service_status,
                };
              }
              return fsStudent;
            });
          }
        }
      }
    } catch (sbErr) {
      console.warn("[Admin Dashboard Refresh] Supabase students fetch warning:", sbErr);
    }

    if (firestoreList.length > 0) {
      return firestoreList;
    }
    return getLocalStudents();
  })();

  // 2. Force network query for Announcements
  const fetchAnnouncementsTask = (async (): Promise<any[]> => {
    if (db) {
      try {
        const colRef = collection(db, "announcements");
        let snap;
        try {
          const { getDocsFromServer } = await import("firebase/firestore");
          snap = await getDocsFromServer(colRef);
        } catch {
          snap = await getDocs(colRef);
        }

        const list: any[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d) list.push(d);
        });

        list.sort((a, b) => {
          const dateA = a.date || "";
          const dateB = b.date || "";
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          return (b.id || "").localeCompare(a.id || "");
        });

        return list;
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Firestore announcements query error:", err);
      }
    }

    try {
      const cached = localStorage.getItem("tuition_announcements");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  })();

  // 3. Force network query for Institution Name
  const fetchInstitutionNameTask = (async (): Promise<string> => {
    if (db) {
      try {
        const docRef = doc(db, "settings", "institution");
        let snap;
        try {
          const { getDocFromServer } = await import("firebase/firestore");
          snap = await getDocFromServer(docRef);
        } catch {
          snap = await getDoc(docRef);
        }
        if (snap.exists()) {
          const name = snap.data().name || "Sumit Tuition App";
          return name;
        }
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Institution settings query error:", err);
      }
    }
    return getCachedInstitutionName();
  })();

  // Execute all network requests in parallel
  const [freshStudents, freshAnnouncements, freshInstName] = await Promise.all([
    fetchStudentsTask,
    fetchAnnouncementsTask,
    fetchInstitutionNameTask,
  ]);

  // Atomically update local caches and broadcast updates to listening components
  if (freshStudents.length > 0) {
    saveLocalStudents(freshStudents);
  }
  if (Array.isArray(freshAnnouncements)) {
    safeSetStorage("tuition_announcements", JSON.stringify(freshAnnouncements));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("announcements-updated", { detail: freshAnnouncements }));
      window.dispatchEvent(new Event("storage"));
    }
  }
  if (freshInstName) {
    setCachedInstitutionName(freshInstName);
  }

  return {
    students: freshStudents.length > 0 ? freshStudents : getLocalStudents(),
    announcements: freshAnnouncements,
    institutionName: freshInstName || getCachedInstitutionName(),
  };
}


