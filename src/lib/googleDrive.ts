import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from "firebase/auth";

// Dynamic configuration loader to prevent compilation errors if the file doesn't exist yet
async function getFirebaseConfig() {
  try {
    const res = await fetch("/firebase-applet-config.json");
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn("Firebase configuration file not found yet. It will be loaded after OAuth setup.", e);
  }
  return null;
}

let authInstance: any = null;
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export async function initFirebase() {
  if (getApps().length > 0) {
    return getAuth(getApp());
  }
  const config = await getFirebaseConfig();
  if (!config) return null;
  const app = initializeApp(config);
  return getAuth(app);
}

// Custom hook/listener for authentication changes
export async function listenToAuth(
  onSuccess: (user: User, token: string) => void,
  onFailure: () => void
) {
  const auth = await initFirebase();
  if (!auth) {
    onFailure();
    return () => {};
  }
  
  return onAuthStateChanged(auth, async (user) => {
    if (user && cachedAccessToken) {
      onSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      onFailure();
    }
  });
}

// Google Sign-In with Drive permissions
export async function signInWithGoogleDrive(): Promise<{ user: User; accessToken: string } | null> {
  const auth = await initFirebase();
  if (!auth) {
    throw new Error("Google Drive integration is currently initializing. Please configure the OAuth settings first.");
  }

  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.file");
  provider.addScope("https://www.googleapis.com/auth/userinfo.email");
  provider.addScope("https://www.googleapis.com/auth/userinfo.profile");

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to retrieve Google Drive API access token.");
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error("Google login failed:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

export async function logoutGoogle() {
  const auth = await initFirebase();
  if (auth) {
    await signOut(auth);
  }
  cachedAccessToken = null;
}

// Fetch files to locate existing tuition ledger backup
async function findBackupFile(accessToken: string): Promise<string | null> {
  const query = encodeURIComponent("name = 'tuition_ledger_backup.json' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;
  
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    throw new Error(`Drive search failed: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

// Backup current state to Google Drive
export async function backupToGoogleDrive(accessToken: string, payload: any): Promise<void> {
  const fileId = await findBackupFile(accessToken);
  const contentBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

  if (fileId) {
    // Update existing file content via PATCH
    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const res = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: contentBlob
    });

    if (!res.ok) {
      throw new Error(`Failed to update Drive backup: ${res.statusText}`);
    }
  } else {
    // Create new file with metadata via Multipart upload
    const boundary = "-------314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: "tuition_ledger_backup.json",
      mimeType: "application/json"
    };

    const reader = new FileReader();
    const payloadText = JSON.stringify(payload, null, 2);

    const multipartBody = 
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      payloadText +
      closeDelimiter;

    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    });

    if (!res.ok) {
      throw new Error(`Failed to create Drive backup: ${res.statusText}`);
    }
  }
}

// Restore state from Google Drive
export async function restoreFromGoogleDrive(accessToken: string): Promise<any> {
  const fileId = await findBackupFile(accessToken);
  if (!fileId) {
    throw new Error("No previous backup found on your Google Drive. Make sure you back up first.");
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to download backup file: ${res.statusText}`);
  }

  return await res.json();
}
