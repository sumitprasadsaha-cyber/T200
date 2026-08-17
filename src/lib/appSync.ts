/**
 * App Initialization & Synchronization Service
 * 
 * Manages:
 * - Real-time listener initialization
 * - Offline sync queue processing
 * - Network connectivity handling
 * - Listener cleanup on logout
 * - Memory leak prevention
 */

import { 
  subscribeToStudents,
  subscribeToStudent,
  subscribeToClassNotes,
  subscribeToTestAttempts,
  subscribeToAnnouncements,
  cleanupAllFirestoreListeners
} from "./firestoreService";
import { initPracticeTestsRealtimeSync } from "./practiceTestService";
import { cleanupAllListeners } from "./realtimeSync";

type UnsubscribeFn = () => void;

interface AppSyncState {
  initialized: boolean;
  unsubscribers: Set<UnsubscribeFn>;
  isOnline: boolean;
  syncInterval: NodeJS.Timeout | null;
}

const appState: AppSyncState = {
  initialized: false,
  unsubscribers: new Set(),
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncInterval: null
};

/**
 * Initialize all real-time listeners for admin dashboard
 */
export function initializeAdminSync(): void {
  if (appState.initialized) {
    console.log("[AppSync] Admin sync already initialized, skipping");
    return;
  }

  console.log("[AppSync] Initializing Admin synchronization...");

  try {
    // 1. Subscribe to all students
    const unsubStudents = subscribeToStudents(
      (students) => {
        console.log(`[AppSync] Students updated: ${students.length} students`);
      },
      (err) => {
        console.warn("[AppSync] Students subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubStudents);

    // 2. Subscribe to class notes
    const unsubClassNotes = subscribeToClassNotes(
      (notes) => {
        console.log(`[AppSync] Class notes updated: ${notes.length} notes`);
      },
      (err) => {
        console.warn("[AppSync] Class notes subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubClassNotes);

    // 3. Subscribe to announcements
    const unsubAnnouncements = subscribeToAnnouncements(
      (announcements) => {
        console.log(`[AppSync] Announcements updated: ${announcements.length} announcements`);
      },
      (err) => {
        console.warn("[AppSync] Announcements subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubAnnouncements);

    // 4. Subscribe to test attempts (for admin reports)
    const unsubTestAttempts = subscribeToTestAttempts(
      (attempts) => {
        console.log(`[AppSync] Test attempts updated: ${attempts.length} attempts`);
      },
      (err) => {
        console.warn("[AppSync] Test attempts subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubTestAttempts);

    // 5. Initialize practice tests real-time sync
    initPracticeTestsRealtimeSync();

    // 6. Set up network connectivity monitoring
    setupNetworkMonitoring();

    appState.initialized = true;
    console.log("[AppSync] Admin synchronization initialized successfully");
  } catch (err) {
    console.error("[AppSync] Failed to initialize admin sync:", err);
  }
}

/**
 * Initialize real-time listeners for student dashboard
 */
export function initializeStudentSync(studentId: string): void {
  if (appState.initialized) {
    console.log("[AppSync] Student sync already initialized, skipping");
    return;
  }

  console.log(`[AppSync] Initializing Student synchronization for ${studentId}...`);

  try {
    // 1. Subscribe to this student's data
    const unsubStudent = subscribeToStudent(
      studentId,
      (student) => {
        console.log(`[AppSync] Student data updated: ${student.name}`);
      },
      (err) => {
        console.warn("[AppSync] Student subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubStudent);

    // 2. Subscribe to class notes (for study materials)
    const unsubClassNotes = subscribeToClassNotes(
      (notes) => {
        console.log(`[AppSync] Class notes updated: ${notes.length} notes`);
      },
      (err) => {
        console.warn("[AppSync] Class notes subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubClassNotes);

    // 3. Subscribe to test attempts (for this student's test results)
    const unsubTestAttempts = subscribeToTestAttempts(
      (attempts) => {
        const studentAttempts = attempts.filter(a => a.studentId === studentId);
        console.log(`[AppSync] Test attempts updated for student: ${studentAttempts.length} attempts`);
      },
      (err) => {
        console.warn("[AppSync] Test attempts subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubTestAttempts);

    // 4. Subscribe to announcements (for notifications)
    const unsubAnnouncements = subscribeToAnnouncements(
      (announcements) => {
        console.log(`[AppSync] Announcements updated: ${announcements.length} announcements`);
      },
      (err) => {
        console.warn("[AppSync] Announcements subscription error:", err);
      }
    );
    appState.unsubscribers.add(unsubAnnouncements);

    // 5. Initialize practice tests real-time sync
    initPracticeTestsRealtimeSync();

    // 6. Set up network connectivity monitoring
    setupNetworkMonitoring();

    appState.initialized = true;
    console.log("[AppSync] Student synchronization initialized successfully");
  } catch (err) {
    console.error("[AppSync] Failed to initialize student sync:", err);
  }
}

/**
 * Set up network connectivity monitoring for offline/online transitions
 */
function setupNetworkMonitoring(): void {
  if (typeof window === "undefined") return;

  const handleOnline = () => {
    console.log("[AppSync] Network connectivity restored, processing sync queue...");
    appState.isOnline = true;
    processSyncQueue();
  };

  const handleOffline = () => {
    console.log("[AppSync] Network connectivity lost, queuing operations...");
    appState.isOnline = false;
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Set up periodic sync check (every 30 seconds while offline)
  if (appState.syncInterval) {
    clearInterval(appState.syncInterval);
  }
  
  appState.syncInterval = setInterval(() => {
    if (appState.isOnline && navigator.onLine) {
      processSyncQueue();
    }
  }, 30000);
}

/**
 * Process offline sync queue
 * This function would be called when connectivity is restored
 */
async function processSyncQueue(): Promise<void> {
  console.log("[AppSync] Checking for pending sync operations...");
  
  // Practice tests and other offline operations are already handled by
  // the practiceTestService and their respective services through
  // their built-in offline sync mechanisms
  
  try {
    // Note: Offline sync is handled automatically by individual services
    // This function is a placeholder for future expansion
    console.log("[AppSync] Sync queue processing check completed");
  } catch (err) {
    console.warn("[AppSync] Error during sync queue processing:", err);
  }
}

/**
 * Cleanup all listeners and resources on logout
 */
export function cleanupOnLogout(): void {
  console.log("[AppSync] Cleaning up listeners on logout...");

  try {
    // Unsubscribe all Firebase listeners
    appState.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        console.warn("[AppSync] Error unsubscribing listener:", err);
      }
    });
    appState.unsubscribers.clear();

    // Clean up Firestore listeners
    cleanupAllFirestoreListeners();

    // Clean up realtimeSync listeners
    cleanupAllListeners();

    // Clear sync interval
    if (appState.syncInterval) {
      clearInterval(appState.syncInterval);
      appState.syncInterval = null;
    }

    // Reset state
    appState.initialized = false;

    // Remove network listeners
    if (typeof window !== "undefined") {
      window.removeEventListener("online", () => {});
      window.removeEventListener("offline", () => {});
    }

    console.log("[AppSync] Cleanup completed successfully");
  } catch (err) {
    console.error("[AppSync] Error during cleanup:", err);
  }
}

/**
 * Cleanup all resources on app unload
 */
export function cleanupOnUnload(): void {
  console.log("[AppSync] App unloading, cleaning up all resources...");
  cleanupOnLogout();
}

/**
 * Get current sync state
 */
export function getSyncState() {
  return {
    initialized: appState.initialized,
    isOnline: appState.isOnline,
    listenerCount: appState.unsubscribers.size,
    hasSyncInterval: appState.syncInterval !== null
  };
}

// Set up cleanup on app unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cleanupOnUnload);
}

export default {
  initializeAdminSync,
  initializeStudentSync,
  cleanupOnLogout,
  cleanupOnUnload,
  getSyncState
};
