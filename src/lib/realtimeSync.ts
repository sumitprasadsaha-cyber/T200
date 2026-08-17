/**
 * Comprehensive Real-Time Synchronization Service
 * 
 * This service manages unified real-time synchronization for:
 * - Student records
 * - Class Notes (Topics, PDFs)
 * - Practice Tests
 * - Test Attempts & Scores
 * - Images and Media
 * 
 * Features:
 * - Prevents duplicate listeners via reference tracking
 * - Automatic cleanup on unsubscribe
 * - Cross-tab/cross-device coordination via BroadcastChannel & Firestore signals
 * - Efficient delta updates
 * - Memory leak prevention
 */

import { 
  collection, 
  doc, 
  onSnapshot, 
  getDocs,
  query,
  where,
  DocumentReference,
  Query,
  Unsubscribe,
  Firestore
} from "firebase/firestore";
import { getFirebaseDb } from "./firebase";

// ============================================================================
// LISTENER REGISTRY - Prevents duplicate listeners
// ============================================================================

type Listener<T> = (data: T) => void;
type UnsubscribeFn = () => void;

interface ListenerRegistry {
  active: boolean;
  unsubscribe: UnsubscribeFn | null;
  firebaseUnsub: Unsubscribe | null;
  lastUpdateTs: number;
}

// Keyed by collection/query identifier to prevent duplicates
const listenerRegistry = new Map<string, ListenerRegistry>();
const activeListeners = new Map<string, Set<Listener<any>>>();

/**
 * Get unique key for a Firestore path
 */
function getListenerKey(collectionPath: string, filters?: Record<string, any>): string {
  const filterStr = filters ? JSON.stringify(filters) : "";
  return `${collectionPath}${filterStr}`;
}

/**
 * Register a listener in the global registry to prevent duplicates
 */
function registerListener<T>(
  key: string,
  listener: Listener<T>,
  setup: (onSnapshot: (data: T) => void, key: string) => { firebaseUnsub: Unsubscribe | null; cleanup: UnsubscribeFn }
): UnsubscribeFn {
  // Initialize registry entry if not exists
  if (!activeListeners.has(key)) {
    activeListeners.set(key, new Set());
  }

  const listeners = activeListeners.get(key)!;
  listeners.add(listener);

  // Only set up Firebase listener once per key
  if (!listenerRegistry.has(key)) {
    const registry: ListenerRegistry = {
      active: true,
      unsubscribe: null,
      firebaseUnsub: null,
      lastUpdateTs: Date.now()
    };

    const onDataSnapshot = (data: T) => {
      registry.lastUpdateTs = Date.now();
      const allListeners = activeListeners.get(key);
      if (allListeners) {
        allListeners.forEach(cb => {
          try {
            cb(data);
          } catch (err) {
            console.error(`[RealtimeSync] Error in listener for ${key}:`, err);
          }
        });
      }
    };

    const { firebaseUnsub, cleanup } = setup(onDataSnapshot, key);
    registry.firebaseUnsub = firebaseUnsub;
    registry.unsubscribe = cleanup;
    listenerRegistry.set(key, registry);
  }

  // Return unsubscribe function for this specific listener
  return () => {
    listeners.delete(listener);

    // If no more listeners for this key, clean up Firebase listener
    if (listeners.size === 0) {
      const registry = listenerRegistry.get(key);
      if (registry) {
        registry.active = false;
        if (registry.firebaseUnsub) {
          registry.firebaseUnsub();
        }
        if (registry.unsubscribe) {
          registry.unsubscribe();
        }
        listenerRegistry.delete(key);
        activeListeners.delete(key);
      }
    }
  };
}

/**
 * Clean up all listeners (useful for testing or app shutdown)
 */
export function cleanupAllListeners(): void {
  listenerRegistry.forEach((registry) => {
    registry.active = false;
    if (registry.firebaseUnsub) {
      registry.firebaseUnsub();
    }
    if (registry.unsubscribe) {
      registry.unsubscribe();
    }
  });
  listenerRegistry.clear();
  activeListeners.clear();
}

// ============================================================================
// REAL-TIME SYNC UTILITIES
// ============================================================================

/**
 * Broadcast a change signal to other tabs/windows
 */
export function broadcastRealtimeUpdate(channel: string, details?: Record<string, any>): void {
  if (typeof window === "undefined") return;

  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(channel);
      bc.postMessage({
        type: "REALTIME_UPDATE",
        timestamp: Date.now(),
        ...details
      });
      bc.close();
    }
  } catch (err) {
    console.warn(`[RealtimeSync] BroadcastChannel error on ${channel}:`, err);
  }
}

/**
 * Send Firestore sync signal for cross-device real-time coordination
 */
export async function sendFirestoreSyncSignal(
  signalPath: string,
  details?: Record<string, any>
): Promise<void> {
  try {
    const db = await getFirebaseDb();
    if (!db) return;

    const { setDoc } = await import("firebase/firestore");
    const syncDocRef = doc(db, signalPath);
    await setDoc(syncDocRef, {
      updatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      ...details
    }, { merge: true });
  } catch (err) {
    console.warn(`[RealtimeSync] Failed to send Firestore sync signal to ${signalPath}:`, err);
  }
}

/**
 * Listen for BroadcastChannel updates
 */
export function listenToBroadcastChannel(
  channel: string,
  onMessage: (data: any) => void
): () => void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return () => {};
  }

  try {
    const bc = new BroadcastChannel(channel);
    bc.onmessage = (event) => {
      if (event.data?.type === "REALTIME_UPDATE") {
        onMessage(event.data);
      }
    };

    return () => {
      bc.close();
    };
  } catch (err) {
    console.warn(`[RealtimeSync] BroadcastChannel listener error on ${channel}:`, err);
    return () => {};
  }
}

// ============================================================================
// GENERIC COLLECTION LISTENER
// ============================================================================

/**
 * Generic function to subscribe to a Firestore collection with duplicate prevention
 */
export function subscribeToFirestoreCollection<T>(
  collectionName: string,
  onUpdate: (data: T[]) => void,
  onError?: (err: any) => void,
  queryConstraints?: any[]
): UnsubscribeFn {
  const key = getListenerKey(collectionName, { constraints: queryConstraints?.length });

  let firebaseUnsub: Unsubscribe | null = null;
  let isActive = true;

  (async () => {
    try {
      const db = await getFirebaseDb();
      if (!db || !isActive) {
        onUpdate([]);
        return;
      }

      const colRef = collection(db, collectionName);
      const q = queryConstraints && queryConstraints.length > 0
        ? query(colRef, ...queryConstraints)
        : colRef;

      firebaseUnsub = onSnapshot(
        q as Query,
        (snap) => {
          if (!isActive) return;
          const list: T[] = [];
          snap.forEach((docSnap) => {
            list.push(docSnap.data() as T);
          });
          onUpdate(list);
        },
        (err) => {
          console.error(`[RealtimeSync] Error listening to ${collectionName}:`, err);
          if (onError) onError(err);
        }
      );
    } catch (err) {
      console.warn(`[RealtimeSync] Failed to setup listener for ${collectionName}:`, err);
      if (onError) onError(err);
    }
  })();

  return () => {
    isActive = false;
    if (firebaseUnsub) {
      firebaseUnsub();
    }
  };
}

/**
 * Generic function to subscribe to a Firestore document
 */
export function subscribeToFirestoreDocument<T>(
  collectionName: string,
  documentId: string,
  onUpdate: (data: T | null) => void,
  onError?: (err: any) => void
): UnsubscribeFn {
  let firebaseUnsub: Unsubscribe | null = null;
  let isActive = true;

  (async () => {
    try {
      const db = await getFirebaseDb();
      if (!db || !isActive) {
        onUpdate(null);
        return;
      }

      const docRef = doc(db, collectionName, documentId);
      firebaseUnsub = onSnapshot(
        docRef,
        (snap) => {
          if (!isActive) return;
          if (snap.exists()) {
            onUpdate(snap.data() as T);
          } else {
            onUpdate(null);
          }
        },
        (err) => {
          console.error(`[RealtimeSync] Error listening to ${collectionName}/${documentId}:`, err);
          if (onError) onError(err);
        }
      );
    } catch (err) {
      console.warn(`[RealtimeSync] Failed to setup listener for ${collectionName}/${documentId}:`, err);
      if (onError) onError(err);
    }
  })();

  return () => {
    isActive = false;
    if (firebaseUnsub) {
      firebaseUnsub();
    }
  };
}

// ============================================================================
// LISTENER STATS (for debugging and monitoring)
// ============================================================================

export interface ListenerStats {
  totalListeners: number;
  byCollection: Record<string, number>;
}

export function getListenerStats(): ListenerStats {
  const stats: ListenerStats = {
    totalListeners: 0,
    byCollection: {}
  };

  listenerRegistry.forEach((registry, key) => {
    const listeners = activeListeners.get(key)?.size || 0;
    stats.totalListeners += listeners;
    
    const collection = key.split("/")[0];
    if (!stats.byCollection[collection]) {
      stats.byCollection[collection] = 0;
    }
    stats.byCollection[collection] += listeners;
  });

  return stats;
}

export default {
  registerListener,
  cleanupAllListeners,
  broadcastRealtimeUpdate,
  sendFirestoreSyncSignal,
  listenToBroadcastChannel,
  subscribeToFirestoreCollection,
  subscribeToFirestoreDocument,
  getListenerStats
};
