import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  uploadObjectToR2,
  headObjectFromR2,
  getR2ServerConfig,
} from "../src/lib/r2Server";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const config = getR2ServerConfig();
const bucket = config.bucket || "academy-connect-files";

function sanitizeKey(rawPath: string): string {
  let cleaned = String(rawPath || "").trim();
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const urlObj = new URL(cleaned);
      const pathname = urlObj.pathname;
      const supabaseMatch = pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^\/]+\/(.+)/
      );
      if (supabaseMatch && supabaseMatch[1]) {
        cleaned = decodeURIComponent(supabaseMatch[1]);
      } else {
        const segments = pathname.replace(/^\/+/, "").split("/");
        if (segments[0] === bucket) segments.shift();
        cleaned = segments.join("/");
      }
    } catch {
      // ignore
    }
  }
  cleaned = cleaned.replace(/^\/+/, "").replace(/\/+/g, "/");
  return cleaned;
}

async function migrateAll() {
  console.log("=== STARTING CLOUDFLARE R2 MIGRATION ===");
  console.log(`R2 Target Bucket: "${bucket}"`);

  // 1. Migrate class_notes
  console.log("\n--- Checking Firestore 'class_notes' collection ---");
  const notesSnap = await getDocs(collection(db, "class_notes"));
  console.log(`Found ${notesSnap.size} class_notes documents in Firestore.`);

  let migratedCount = 0;
  let alreadyR2Count = 0;
  let failedCount = 0;

  for (const docSnap of notesSnap.docs) {
    const data = docSnap.data();
    const rawPath = data.storagePath || data.storage_path || data.pdfUrl || "";
    const cleanKey = sanitizeKey(rawPath);

    if (!cleanKey) {
      console.warn(`[class_notes] Skipped doc ${docSnap.id} - no valid key`);
      continue;
    }

    console.log(`[class_notes] Processing doc ${docSnap.id} -> key: "${cleanKey}"`);

    // Check if object already exists in R2
    const existingHead = await headObjectFromR2({ bucket, key: cleanKey });
    let fileBuffer: Buffer | null = null;
    let mimeType = data.mimeType || data.mime_type || (cleanKey.endsWith(".pdf") ? "application/pdf" : "image/png");

    if (existingHead.exists) {
      console.log(`  ✓ Object already exists in R2 (${existingHead.contentLength} bytes).`);
      alreadyR2Count++;
    } else {
      // Need to fetch from Supabase URL or existing pdfUrl
      const sourceUrl = data.pdfUrl || data.downloadUrl;
      if (sourceUrl && (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://"))) {
        console.log(`  Fetching source file from: ${sourceUrl.substring(0, 100)}...`);
        try {
          const res = await fetch(sourceUrl);
          if (res.ok) {
            const arrBuf = await res.arrayBuffer();
            fileBuffer = Buffer.from(arrBuf);
            mimeType = res.headers.get("content-type") || mimeType;
            console.log(`  Downloaded ${fileBuffer.length} bytes. Uploading to R2...`);
            
            await uploadObjectToR2({
              bucket,
              key: cleanKey,
              body: fileBuffer,
              contentType: mimeType,
            });
            console.log(`  ✓ Uploaded to R2 successfully: "${cleanKey}"`);
            migratedCount++;
          } else {
            console.error(`  ✗ Failed to fetch source file (HTTP ${res.status}): ${sourceUrl}`);
            failedCount++;
          }
        } catch (fetchErr: any) {
          console.error(`  ✗ Fetch/upload error for ${sourceUrl}:`, fetchErr.message);
          failedCount++;
        }
      } else {
        console.warn(`  ! No download source URL available for key "${cleanKey}".`);
      }
    }

    // Update document in Firestore to point cleanly to R2
    const downloadUrl = `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`;
    const updatePayload: Record<string, any> = {
      storageProvider: "r2",
      bucket,
      storagePath: cleanKey,
      storage_path: cleanKey,
      pdfUrl: downloadUrl,
      downloadUrl: downloadUrl,
      fileName: data.fileName || data.filename || cleanKey.split("/").pop() || "file.pdf",
      filename: data.fileName || data.filename || cleanKey.split("/").pop() || "file.pdf",
      mimeType: mimeType,
      mime_type: mimeType,
      uploadedAt: data.uploadedAt || data.uploaded_at || new Date().toISOString(),
      uploaded_at: data.uploadedAt || data.uploaded_at || new Date().toISOString(),
    };

    try {
      await updateDoc(doc(db, "class_notes", docSnap.id), updatePayload);
      console.log(`  ✓ Updated Firestore doc ${docSnap.id}`);
    } catch (dbErr: any) {
      console.error(`  ✗ Firestore update error for ${docSnap.id}:`, dbErr.message);
    }
  }

  // 2. Migrate students
  console.log("\n--- Checking Firestore 'students' collection ---");
  const studentsSnap = await getDocs(collection(db, "students"));
  console.log(`Found ${studentsSnap.size} students documents in Firestore.`);

  for (const studentDoc of studentsSnap.docs) {
    const student = studentDoc.data();
    let studentUpdated = false;

    // Check student.notes
    if (student.notes && typeof student.notes === "object") {
      const updatedNotes: Record<string, any[]> = {};
      for (const [subject, notesArr] of Object.entries(student.notes)) {
        if (Array.isArray(notesArr)) {
          updatedNotes[subject] = notesArr.map((n: any) => {
            const raw = n.storagePath || n.storage_path || n.pdfUrl || "";
            const k = sanitizeKey(raw);
            if (k) {
              studentUpdated = true;
              return {
                ...n,
                storageProvider: "r2",
                bucket,
                storagePath: k,
                storage_path: k,
                pdfUrl: `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}`,
                downloadUrl: `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}`,
              };
            }
            return n;
          });
        }
      }
      if (studentUpdated) {
        student.notes = updatedNotes;
      }
    }

    // Check student.reports
    if (Array.isArray(student.reports) && student.reports.length > 0) {
      student.reports = student.reports.map((r: any) => {
        const raw = r.storagePath || r.downloadUrl || "";
        const k = sanitizeKey(raw);
        if (k) {
          studentUpdated = true;
          return {
            ...r,
            storageProvider: "r2",
            bucket,
            storagePath: k,
            downloadUrl: `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}`,
          };
        }
        return r;
      });
    }

    // Check student.avatarUrl
    if (student.avatarUrl && student.avatarUrl.includes("supabase.co")) {
      const k = sanitizeKey(student.avatarUrl);
      if (k) {
        studentUpdated = true;
        student.avatarStorageProvider = "r2";
        student.avatarBucket = bucket;
        student.avatarStoragePath = k;
        student.avatarUrl = `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}`;
      }
    }

    if (studentUpdated) {
      try {
        await setDoc(doc(db, "students", studentDoc.id), student, { merge: true });
        console.log(`  ✓ Updated student ${studentDoc.id} (${student.name})`);
      } catch (err: any) {
        console.error(`  ✗ Error updating student ${studentDoc.id}:`, err.message);
      }
    }
  }

  console.log("\n=== MIGRATION SUMMARY ===");
  console.log(`Already in R2: ${alreadyR2Count}`);
  console.log(`Newly Migrated to R2: ${migratedCount}`);
  console.log(`Failed Migrations: ${failedCount}`);
  console.log("=========================================");
}

migrateAll()
  .then(() => {
    console.log("Migration completed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
