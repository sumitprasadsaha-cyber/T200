import { uploadFileToR2, deleteFileFromStorage, getResolvedViewUrl } from "../src/lib/storageService";
import { uploadToR2, downloadFromR2, deleteFromR2 } from "../src/lib/r2Client";
import { saveClassNoteDoc, deleteClassNoteDoc, getLocalClassNotes } from "../src/lib/firestoreService";
import { openPdfWithNativeViewer } from "../src/lib/nativePdfService";
import { ClassNote } from "../src/types";

const BASE_URL = "http://localhost:3000";

async function runEndToEndVerification() {
  console.log("================================================================================");
  console.log("             REGRESSION AUDIT & END-TO-END VERIFICATION SUITE                  ");
  console.log("================================================================================\n");

  const results: Record<string, "PASS" | "FAIL"> = {};
  const failureDetails: any[] = [];

  const pdfContent = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF"
  );
  const pdfBlob = new Blob([pdfContent], { type: "application/pdf" });

  let noteId = `note-${Date.now()}-e2e`;
  let storagePath = `class_notes/Class_10/Mathematics/${Date.now()}_Real_Numbers.pdf`;
  let fileName = "Real_Numbers.pdf";
  let bucket = "academy-connect-files";
  let classNote: ClassNote | null = null;

  // ---------------------------------------------------------------------------
  // 1. WORKFLOW: UPLOAD (Frontend -> Express -> R2 -> Supabase/Firestore -> UI)
  // ---------------------------------------------------------------------------
  console.log(">>> [1/5] Testing WORKFLOW: UPLOAD...");
  try {
    const uploadRes = await uploadFileToR2(
      bucket,
      storagePath,
      pdfBlob,
      fileName,
      "Admin"
    );

    if (!uploadRes.downloadUrl || !uploadRes.storagePath) {
      throw new Error(`Upload returned invalid metadata: ${JSON.stringify(uploadRes)}`);
    }

    const nowIso = new Date().toISOString();
    classNote = {
      id: noteId,
      classGrade: "Class 10",
      subject: "Mathematics",
      chapterNo: 1,
      chapterName: "Real Numbers",
      partLabel: "Theorem 1.1",
      pdfUrl: uploadRes.downloadUrl,
      pdfFileName: fileName,
      fileName: fileName,
      filename: fileName,
      storagePath: uploadRes.storagePath,
      storage_path: uploadRes.storagePath,
      bucket: uploadRes.bucket,
      fileType: "pdf",
      mimeType: "application/pdf",
      mime_type: "application/pdf",
      fileSize: pdfContent.length,
      file_size: pdfContent.length,
      createdAt: nowIso,
      uploadedAt: nowIso,
      uploaded_at: nowIso,
      uploadedBy: "Admin",
    };

    await saveClassNoteDoc(classNote);
    console.log("  [Upload] Result:", uploadRes);
    results["Upload"] = "PASS";
  } catch (err: any) {
    results["Upload"] = "FAIL";
    failureDetails.push({
      workflow: "Upload",
      file: "src/lib/storageService.ts / src/lib/r2Client.ts",
      function: "uploadFileToR2 / uploadToR2",
      error: err.message,
    });
    console.error("  FAILED Upload:", err);
  }

  // ---------------------------------------------------------------------------
  // 2. WORKFLOW: OPEN (Frontend -> Express -> R2 -> Viewer)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [2/5] Testing WORKFLOW: OPEN (Viewer Resolution)...");
  try {
    if (!classNote) throw new Error("Class note was not created in step 1");

    const openRes = await openPdfWithNativeViewer({
      url: classNote.pdfUrl,
      title: classNote.chapterName,
      storagePath: classNote.storagePath,
      bucket: classNote.bucket,
      noteId: classNote.id,
      fileName: classNote.fileName,
      mimeType: classNote.mimeType,
      fileType: classNote.fileType,
    });

    if (!openRes.success || !openRes.blob || openRes.blob.size === 0) {
      throw new Error(`Open PDF failed: ${JSON.stringify(openRes)}`);
    }
    console.log(`  [Open] Viewer successfully resolved blob (${openRes.blob.size} bytes)`);
    results["Open"] = "PASS";
  } catch (err: any) {
    results["Open"] = "FAIL";
    failureDetails.push({
      workflow: "Open",
      file: "src/lib/nativePdfService.ts",
      function: "openPdfWithNativeViewer",
      error: err.message,
    });
    console.error("  FAILED Open:", err);
  }

  // ---------------------------------------------------------------------------
  // 3. WORKFLOW: DOWNLOAD (Frontend -> Express -> R2 -> Browser)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [3/5] Testing WORKFLOW: DOWNLOAD...");
  try {
    if (!classNote) throw new Error("Class note was not created in step 1");

    const dlRes = await downloadFromR2({
      bucket: classNote.bucket,
      key: classNote.storagePath!,
    });

    if (!dlRes.blob || dlRes.blob.size !== pdfContent.length) {
      throw new Error(`Downloaded blob size mismatch: expected ${pdfContent.length}, got ${dlRes.blob?.size}`);
    }
    console.log(`  [Download] Successfully received ${dlRes.blob.size} bytes (MIME: ${dlRes.mimeType})`);
    results["Download"] = "PASS";
  } catch (err: any) {
    results["Download"] = "FAIL";
    failureDetails.push({
      workflow: "Download",
      file: "src/lib/r2Client.ts / server.ts",
      function: "downloadFromR2 / GET /api/r2/download",
      error: err.message,
    });
    console.error("  FAILED Download:", err);
  }

  // ---------------------------------------------------------------------------
  // 4. WORKFLOW: REPLACE (Upload new -> Update Supabase -> Delete old -> Refresh UI)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [4/5] Testing WORKFLOW: REPLACE...");
  let replacedStoragePath = "";
  try {
    if (!classNote) throw new Error("Class note was not created in step 1");

    const oldStoragePath = classNote.storagePath!;
    const replacementBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n% REPLACED_VERSION_V2\n%%EOF"
    );
    const replacementBlob = new Blob([replacementBuffer], { type: "application/pdf" });
    const replacementFileName = "Real_Numbers_V2.pdf";
    replacedStoragePath = `class_notes/Class_10/Mathematics/${Date.now()}_${replacementFileName}`;

    // A. Delete old storage object
    await deleteFileFromStorage(oldStoragePath, classNote.bucket);
    console.log(`  [Replace] 1. Deleted old object: "${oldStoragePath}"`);

    // B. Upload new replacement file
    const replaceUploadRes = await uploadFileToR2(
      classNote.bucket || bucket,
      replacedStoragePath,
      replacementBlob,
      replacementFileName,
      "Admin"
    );
    console.log(`  [Replace] 2. Uploaded replacement object: "${replacedStoragePath}"`);

    // C. Update database record
    classNote = {
      ...classNote,
      pdfUrl: replaceUploadRes.downloadUrl,
      pdfFileName: replacementFileName,
      fileName: replacementFileName,
      filename: replacementFileName,
      storagePath: replaceUploadRes.storagePath,
      storage_path: replaceUploadRes.storagePath,
      fileSize: replacementBuffer.length,
      file_size: replacementBuffer.length,
      updatedAt: new Date().toISOString(),
    };
    await saveClassNoteDoc(classNote);
    console.log(`  [Replace] 3. Database metadata updated successfully.`);

    // Verify new file exists in R2
    const verifyNewDl = await downloadFromR2({
      bucket: classNote.bucket,
      key: replacedStoragePath,
    });
    if (verifyNewDl.blob.size !== replacementBuffer.length) {
      throw new Error(`Replacement verification failed: expected ${replacementBuffer.length} bytes, got ${verifyNewDl.blob.size}`);
    }

    // Verify old file is gone
    let oldStillExists = false;
    try {
      const oldCheck = await fetch(
        `${BASE_URL}/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(oldStoragePath)}`
      );
      if (oldCheck.status === 200) oldStillExists = true;
    } catch {
      oldStillExists = false;
    }
    if (oldStillExists) {
      throw new Error(`Old file "${oldStoragePath}" still exists in storage after replacement!`);
    }

    console.log("  [Replace] Verified: Old object removed, new object stored, database synchronized.");
    results["Replace"] = "PASS";
  } catch (err: any) {
    results["Replace"] = "FAIL";
    failureDetails.push({
      workflow: "Replace",
      file: "src/components/AdminNotesView.tsx (handleSaveReplacePdf)",
      function: "handleSaveReplacePdf / deleteFileFromStorage / uploadFileToR2",
      error: err.message,
    });
    console.error("  FAILED Replace:", err);
  }

  // ---------------------------------------------------------------------------
  // 5. WORKFLOW: DELETE (Delete R2 -> Delete Supabase -> Refresh UI)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [5/5] Testing WORKFLOW: DELETE...");
  try {
    if (!classNote) throw new Error("Class note was not created in step 1");

    const currentPath = classNote.storagePath || replacedStoragePath;

    // A. Delete file from R2
    await deleteFileFromStorage(currentPath, classNote.bucket);
    console.log(`  [Delete] 1. Deleted object from R2: "${currentPath}"`);

    // B. Delete database document
    await deleteClassNoteDoc(classNote.id);
    console.log(`  [Delete] 2. Deleted metadata document: id="${classNote.id}"`);

    // C. Verify object is removed from R2
    let objectStillExists = false;
    try {
      const check = await fetch(
        `${BASE_URL}/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(currentPath)}`
      );
      if (check.status === 200) objectStillExists = true;
    } catch {
      objectStillExists = false;
    }
    if (objectStillExists) {
      throw new Error(`File "${currentPath}" still exists in R2 after deletion!`);
    }

    // D. Verify removed from notes list
    const notes = getLocalClassNotes();
    const found = notes.some((n) => n.id === classNote?.id);
    if (found) {
      throw new Error(`Note document ${classNote.id} still found in notes list after deletion!`);
    }

    console.log("  [Delete] Verified: Storage object destroyed and database record deleted cleanly.");
    results["Delete"] = "PASS";
  } catch (err: any) {
    results["Delete"] = "FAIL";
    failureDetails.push({
      workflow: "Delete",
      file: "src/components/AdminNotesView.tsx (handleConfirmDelete)",
      function: "handleConfirmDelete / deleteFileFromStorage / deleteClassNoteDoc",
      error: err.message,
    });
    console.error("  FAILED Delete:", err);
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                           VERIFICATION SUITE SUMMARY                           ");
  console.log("================================================================================");
  for (const [key, val] of Object.entries(results)) {
    console.log(`${key.padEnd(30)}: ${val}`);
  }
  if (failureDetails.length > 0) {
    console.log("\nFailures Detail:");
    console.table(failureDetails);
  }
  console.log("================================================================================\n");

  if (Object.values(results).some((r) => r === "FAIL")) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEndToEndVerification().catch((e) => {
  console.error("Verification suite fatal:", e);
  process.exit(1);
});
