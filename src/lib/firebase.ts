import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const metaEnv = (import.meta as any).env || {};

export const firebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || "AIzaSyASbswlD6JRb_jEoYE4JVcMsolPyR6t5to",
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || "academy-connect-500d1.firebaseapp.com",
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || "academy-connect-500d1",
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || "academy-connect-500d1.firebasestorage.app",
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || "835356071946",
  appId: metaEnv.VITE_FIREBASE_APP_ID || "1:835356071946:web:5450b3be3cb3ee79aa67f3",
  measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID || "G-Q8LJ49FNCK"
};

let appInstance: any = null;
let dbInstance: any = null;
let authInstance: any = null;
let initializationPromise: Promise<void> | null = null;

export async function ensureFirebaseInitialized(): Promise<void> {
  if (appInstance) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      console.log("[Firebase Environment Check]", {
        VITE_FIREBASE_PROJECT_ID: metaEnv.VITE_FIREBASE_PROJECT_ID || "(not defined, using fallback)",
        VITE_FIREBASE_AUTH_DOMAIN: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || "(not defined, using fallback)",
        VITE_FIREBASE_STORAGE_BUCKET: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || "(not defined, using fallback)",
        VITE_FIREBASE_MESSAGING_SENDER_ID: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || "(not defined, using fallback)",
        VITE_FIREBASE_APP_ID: metaEnv.VITE_FIREBASE_APP_ID || "(not defined, using fallback)",
        apiKeyLoaded: Boolean(metaEnv.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey)
      });

      let config: any = null;

      // 1. Try to fetch dynamic configuration if available
      try {
        const res = await fetch("/firebase-applet-config.json");
        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            config = await res.json();
            console.log("[Firebase] Loaded configuration from firebase-applet-config.json");
          }
        }
      } catch (e) {
        // Fallback
      }

      // 2. Try loading from VITE_ environment variables
      if (!config && metaEnv.VITE_FIREBASE_API_KEY) {
        config = {
          apiKey: metaEnv.VITE_FIREBASE_API_KEY,
          authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
          storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: metaEnv.VITE_FIREBASE_APP_ID,
          measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID,
        };
        console.log("[Firebase] Loaded configuration from VITE_ environment variables");
      }

      // 3. Fallback to hardcoded default config
      if (!config) {
        config = firebaseConfig;
        console.log("[Firebase] Using default firebaseConfig:", {
          projectId: config.projectId,
          authDomain: config.authDomain,
          storageBucket: config.storageBucket,
          appId: config.appId
        });
      }

      if (getApps().length > 0) {
        appInstance = getApp();
        console.log("[Firebase] Single app instance verified (reusing existing app):", appInstance.name);
      } else {
        appInstance = initializeApp(config);
        console.log("[Firebase] initializeApp() executed once for app:", appInstance.name);
      }

      authInstance = getAuth(appInstance);
      if (typeof window !== "undefined") {
        try {
          // Explicitly configure browser local persistence for uninterrupted session longevity
          setPersistence(authInstance, browserLocalPersistence).catch((persistErr) => {
            console.warn("[Firebase] Could not set browserLocalPersistence, using fallback persistence:", persistErr);
          });
        } catch (persistSetupErr) {
          console.warn("[Firebase] Persistence configuration warning:", persistSetupErr);
        }
      }
      dbInstance = getFirestore(appInstance);
      console.log("[Firebase] getAuth() bound to initialized app:", authInstance.app.name);
    } catch (err) {
      console.error("[Firebase Error] Initialization failed:", err);
      appInstance = null;
      authInstance = null;
      dbInstance = null;
    }
  })();

  return initializationPromise;
}

/**
 * Creates a new Auth user via a secondary Firebase app instance.
 * This prevents the current active user (admin) from being signed out on the client.
 */
export async function createNewUserAuth(email: string, password: string): Promise<string> {
  await ensureFirebaseInitialized();
  
  // Try to load active dynamic config, or fallback to default
  let config: any = null;
  try {
    const res = await fetch("/firebase-applet-config.json");
    if (res.ok) {
      config = await res.json();
    }
  } catch (e) {
    // Ignored, will fallback
  }

  const metaEnv = (import.meta as any).env || {};
  if (!config && metaEnv.VITE_FIREBASE_API_KEY) {
    config = {
      apiKey: metaEnv.VITE_FIREBASE_API_KEY,
      authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
      storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: metaEnv.VITE_FIREBASE_APP_ID,
      measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID,
    };
  }

  if (!config) {
    config = firebaseConfig;
  }

  const secondaryAppName = `secondary-app-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(config, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    // Clean up secondary auth
    await secondaryAuth.signOut();
    return uid;
  } catch (err: any) {
    const errCode = (err?.code || "").toLowerCase();
    const errMsg = (err?.message || "").toLowerCase();
    if (errCode.includes("email-already-in-use") || errMsg.includes("email-already-in-use")) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
        const uid = cred.user.uid;
        await secondaryAuth.signOut();
        return uid;
      } catch (signInErr: any) {
        console.warn("[createNewUserAuth] Email already exists in Auth, using fallback UID:", signInErr?.code || signInErr?.message);
        const fallbackUid = `user_${email.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_")}`;
        return fallbackUid;
      }
    }
    throw err;
  } finally {
    // We don't delete the app dynamically as it is lightweight, but signing out is sufficient.
  }
}

export async function getFirebaseApp() {
  await ensureFirebaseInitialized();
  return appInstance;
}

export async function getFirebaseAuth() {
  await ensureFirebaseInitialized();
  return authInstance;
}

export async function getFirebaseDb() {
  await ensureFirebaseInitialized();
  return dbInstance;
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {},
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(errMsg || `Database error on ${path || "operation"}`);
}
