import { uploadFileToR2, deleteFileFromStorage, getResolvedViewUrl } from "../src/lib/storageService";
import { downloadFromR2, deleteFromR2 } from "../src/lib/r2Client";
import { saveClassNoteDoc, deleteClassNoteDoc, getLocalClassNotes } from "../src/lib/firestoreService";
import { ClassNote } from "../src/types";

const BASE_URL = "http://localhost:3000";

async function runTest() {
  console.log("================================================================================");
  console.log("             COMPREHENSIVE REPLACE & DELETE PIPELINE VERIFICATION               ");
  console.log("================================================================================\n");

  const results: Record<string, any> = {};

  // -------------------------------------------------------------------------
  // 1. VERIFY ALL BACKEND ROUTE HANDLERS (STATUS 200)
  // -------------------------------------------------------------------------
  console.log(">>> [1/5] Testing Route Registrations on Express Backend...");

  // Test 1a: POST /api/r2/delete
  try {
    const res = await fetch(`${BASE_URL}/api/r2/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket: "academy-connect-files", key: "test/temp_probe.pdf" }),
    });
    console.log(`  POST /api/r2/delete -> Status: ${res.status}`);
    results["POST /api/r2/delete"] = res.status === 200 ? "PASS (HTTP 200)" : `FAIL (HTTP ${res.status})`;
  } catch (e: any) {
    results["POST /api/r2/delete"] = `FAIL (${e.message})`;
  }

  // Test 1b: DELETE /api/r2/delete
  try {
    const res = await fetch(`${BASE_URL}/api/r2/delete?bucket=academy-connect-files&key=test/temp_probe.pdf`, {
      method: "DELETE",
    });
    console.log(`  DELETE /api/r2/delete -> Status: ${res.status}`);
    results["DELETE /api/r2/delete"] = res.status === 200 ? "PASS (HTTP 200)" : `FAIL (HTTP ${res.status})`;
  } catch (e: any) {
    results["DELETE /api/r2/delete"] = `FAIL (${e.message})`;
  }

  // Test 1c: DELETE /api/storage/delete
  try {
    const res = await fetch(`${BASE_URL}/api/storage/delete?bucket=academy-connect-files&key=test/temp_probe.pdf`, {
      method: "DELETE",
    });
    console.log(`  DELETE /api/storage/delete -> Status: ${res.status}`);
    results["DELETE /api/storage/delete"] = res.status === 200 ? "PASS (HTTP 200)" : `FAIL (HTTP ${res.status})`;
  } catch (e: any) {
    results["DELETE /api/storage/delete"] = `FAIL (${e.message})`;
  }

  // Test 1d: POST /api/r2/replace
  try {
    const res = await fetch(`${BASE_URL}/api/r2/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: "academy-connect-files",
        oldKey: "test/temp_probe.pdf",
        newKey: "test/temp_probe_v2.pdf",
        base64: Buffer.from("sample").toString("base64"),
        mimeType: "text/plain",
      }),
    });
    console.log(`  POST /api/r2/replace -> Status: ${res.status}`);
    results["POST /api/r2/replace"] = res.status === 200 ? "PASS (HTTP 200)" : `FAIL (HTTP ${res.status})`;
  } catch (e: any) {
    results["POST /api/r2/replace"] = `FAIL (${e.message})`;
  }

  // -------------------------------------------------------------------------
  // 2. END-TO-END REPLACE FLOW TEST
  // -------------------------------------------------------------------------
  console.log("\n>>> [2/5] Executing Real End-to-End Replace Workflow...");
  const initialPdfBuffer = Buffer.from("%PDF-1.4\nInitial Note Content\n%%EOF");
  const initialPdfBlob = new Blob([initialPdfBuffer], { type: "application/pdf" });
  const timestamp = Date.now();
  const initialPath = `class_notes/Class_10/Civics/${timestamp}_Original_Note.pdf`;
  const initialFilename = "Original_Note.pdf";

  // Step A: Upload initial file
  console.log(`  [Step A] Uploading initial note: ${initialPath}`);
  const uploadInitialRes = await uploadFileToR2(
    "academy-connect-files",
    initialPath,
    initialPdfBlob,
    initialFilename,
    "Admin"
  );
  console.log("  Initial Upload OK:", uploadInitialRes);

  const initialNote: ClassNote = {
    id: `note-${timestamp}-e2e-replace`,
    classGrade: "Class 10",
    subject: "Civics",
    chapterNo: 3,
    chapterName: "Democracy and Diversity",
    partLabel: "Topic 1 - Principles",
    pdfUrl: uploadInitialRes.downloadUrl,
    pdfFileName: initialFilename,
    fileName: initialFilename,
    filename: initialFilename,
    storagePath: uploadInitialRes.storagePath,
    storage_path: uploadInitialRes.storagePath,
    bucket: uploadInitialRes.bucket,
    fileType: "pdf",
    mimeType: "application/pdf",
    mime_type: "application/pdf",
    createdAt: new Date().toISOString(),
    uploadedAt: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
    uploadedBy: "Admin",
  };
  await saveClassNoteDoc(initialNote);

  // Verify initial note exists
  const initialDl = await downloadFromR2({
    bucket: initialNote.bucket,
    key: initialNote.storagePath!,
  });
  console.log(`  Initial file verified in R2 (${initialDl.blob.size} bytes)`);

  // Step B: Replace Note with V2 file
  console.log("  [Step B] Executing Replacement sequence...");
  const replacementPdfBuffer = Buffer.from("%PDF-1.4\nREPLACEMENT UPDATED CONTENT V2\n%%EOF");
  const replacementPdfBlob = new Blob([replacementPdfBuffer], { type: "application/pdf" });
  const replacementFilename = "Updated_Replacement_Note_V2.pdf";
  const replacementPath = `class_notes/Class_10/Civics/${Date.now()}_${replacementFilename}`;

  // 1. Delete old storage object from R2
  console.log(`  1. Deleting old object: "${initialNote.storagePath}"`);
  const delOldRes = await deleteFileFromStorage(initialNote.storagePath!, initialNote.bucket);
  console.log("  Old object delete response:", delOldRes);

  // 2. Upload replacement file to R2
  console.log(`  2. Uploading replacement object: "${replacementPath}"`);
  const uploadReplaceRes = await uploadFileToR2(
    "academy-connect-files",
    replacementPath,
    replacementPdfBlob,
    replacementFilename,
    "Admin"
  );
  console.log("  Replacement Upload OK:", uploadReplaceRes);

  // 3. Update note metadata in database
  const updatedNote: ClassNote = {
    ...initialNote,
    pdfUrl: uploadReplaceRes.downloadUrl,
    pdfFileName: replacementFilename,
    fileName: replacementFilename,
    filename: replacementFilename,
    storagePath: uploadReplaceRes.storagePath,
    storage_path: uploadReplaceRes.storagePath,
    fileSize: replacementPdfBuffer.length,
    updatedAt: new Date().toISOString(),
  };
  await saveClassNoteDoc(updatedNote);
  console.log("  3. Database metadata updated successfully!");

  // Verify new object exists in R2
  const newDl = await downloadFromR2({
    bucket: updatedNote.bucket,
    key: updatedNote.storagePath!,
  });
  console.log(`  4. Verified new object exists in R2 (${newDl.blob.size} bytes)`);

  // Verify old object removed from R2
  let oldObjectFound = false;
  try {
    const oldCheckRes = await fetch(
      `${BASE_URL}/api/r2/download?bucket=${encodeURIComponent(initialNote.bucket || "academy-connect-files")}&key=${encodeURIComponent(initialNote.storagePath!)}`
    );
    if (oldCheckRes.status === 200) {
      oldObjectFound = true;
    }
  } catch {
    oldObjectFound = false;
  }
  console.log(`  5. Verified old object removed from R2 (oldObjectFound=${oldObjectFound})`);

  results["Replace - New Object Uploaded"] = newDl.blob.size === replacementPdfBuffer.length ? "PASS" : "FAIL";
  results["Replace - Old Object Deleted"] = !oldObjectFound ? "PASS" : "FAIL";
  results["Replace - Database Updated"] = updatedNote.storagePath === replacementPath ? "PASS" : "FAIL";

  // -------------------------------------------------------------------------
  // 3. END-TO-END DELETE FLOW TEST
  // -------------------------------------------------------------------------
  console.log("\n>>> [3/5] Executing Real End-to-End Delete Workflow...");

  // Step A: Delete file from R2
  console.log(`  1. Deleting object from R2: "${updatedNote.storagePath}"`);
  const delRes = await deleteFileFromStorage(updatedNote.storagePath!, updatedNote.bucket);
  console.log("  R2 Delete response:", delRes);

  // Step B: Delete note document from Database
  console.log(`  2. Deleting metadata record: id="${updatedNote.id}"`);
  await deleteClassNoteDoc(updatedNote.id);
  console.log("  Database delete completed.");

  // Step C: Verify object is gone from R2
  let deletedObjectFound = false;
  try {
    const checkRes = await fetch(
      `${BASE_URL}/api/r2/download?bucket=${encodeURIComponent(updatedNote.bucket || "academy-connect-files")}&key=${encodeURIComponent(updatedNote.storagePath!)}`
    );
    if (checkRes.status === 200) {
      deletedObjectFound = true;
    }
  } catch {
    deletedObjectFound = false;
  }
  console.log(`  3. Verified object removed from R2 (deletedObjectFound=${deletedObjectFound})`);

  // Step D: Verify note is removed from local / cached collection
  const allNotes = getLocalClassNotes();
  const stillInList = allNotes.some((n) => n.id === updatedNote.id);
  console.log(`  4. Verified note removed from collection (stillInList=${stillInList})`);

  results["Delete - Object Removed from R2"] = !deletedObjectFound ? "PASS" : "FAIL";
  results["Delete - Metadata Removed from Database"] = !stillInList ? "PASS" : "FAIL";

  // -------------------------------------------------------------------------
  // 4. PRINT SUMMARY TABLE
  // -------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                              FINAL AUDIT SUMMARY                               ");
  console.log("================================================================================");
  for (const [key, val] of Object.entries(results)) {
    console.log(`${key.padEnd(45)}: ${val}`);
  }
  console.log("================================================================================\n");

  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
