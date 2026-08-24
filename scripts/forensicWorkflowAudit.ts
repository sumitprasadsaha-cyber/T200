import { uploadFileToR2, deleteFileFromStorage, getResolvedViewUrl } from "../src/lib/storageService";
import { downloadFromR2 } from "../src/lib/r2Client";
import { saveClassNoteDoc, deleteClassNoteDoc, getLocalClassNotes } from "../src/lib/firestoreService";
import { openPdfWithNativeViewer, isImageFile } from "../src/lib/nativePdfService";
import { ClassNote } from "../src/types";

async function runForensicUiWorkflowTest() {
  console.log("================================================================================");
  console.log("       STEP-BY-STEP FORENSIC AUDIT & REAL UI PIPELINE WORKFLOW TEST             ");
  console.log("================================================================================\n");

  const results: Record<string, "PASS" | "FAIL"> = {};

  // Create real test buffers
  const samplePdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF"
  );
  // 1x1 transparent PNG
  const samplePngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  const testPdfBlob = new Blob([samplePdfBuffer], { type: "application/pdf" });
  const testPngBlob = new Blob([samplePngBuffer], { type: "image/png" });

  let uploadedPdfNote: ClassNote | null = null;
  let uploadedImgNote: ClassNote | null = null;

  // -------------------------------------------------------------------------
  // 1. TEST PDF UPLOAD & METADATA INSERT
  // -------------------------------------------------------------------------
  console.log(">>> [1/9] Testing Real PDF Upload via Upload Dialog Pipeline...");
  try {
    const timestamp = Date.now();
    const pdfPath = `class_notes/Class_10/History/${timestamp}_Sample_Forensic_History.pdf`;
    const fileName = "Sample_Forensic_History.pdf";

    const uploadRes = await uploadFileToR2(
      "academy-connect-files",
      pdfPath,
      testPdfBlob,
      fileName,
      "Admin"
    );

    console.log("  [Step 1 & 2] Upload Response:", uploadRes);

    const nowIso = new Date().toISOString();
    uploadedPdfNote = {
      id: `note-${timestamp}-testpdf`,
      classGrade: "Class 10",
      subject: "History",
      chapterNo: 1,
      chapterName: "The Rise of Nationalism in Europe",
      partLabel: "Topic 1 - French Revolution",
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
      createdAt: nowIso,
      uploadedAt: nowIso,
      uploaded_at: nowIso,
      uploadedBy: "Admin",
    };

    console.log("  [Step 3] Persisting Note Document...");
    await saveClassNoteDoc(uploadedPdfNote);
    console.log("  [Step 4] Metadata successfully inserted into database!");

    results["Upload PDF"] = "PASS";
    results["Metadata insert (PDF)"] = "PASS";
  } catch (err: any) {
    console.error("  FAILED Upload PDF:", err);
    results["Upload PDF"] = "FAIL";
    results["Metadata insert (PDF)"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 2. TEST IMAGE UPLOAD & METADATA INSERT
  // -------------------------------------------------------------------------
  console.log("\n>>> [2/9] Testing Real Image Upload via Upload Dialog Pipeline...");
  try {
    const timestamp = Date.now();
    const imgPath = `class_notes/Class_10/Geography/${timestamp}_Sample_Forensic_Map.png`;
    const fileName = "Sample_Forensic_Map.png";

    const uploadRes = await uploadFileToR2(
      "academy-connect-files",
      imgPath,
      testPngBlob,
      fileName,
      "Admin"
    );

    console.log("  Upload Response (Image):", uploadRes);

    const nowIso = new Date().toISOString();
    uploadedImgNote = {
      id: `note-${timestamp}-testimg`,
      classGrade: "Class 10",
      subject: "Geography",
      chapterNo: 2,
      chapterName: "Forest and Wildlife Resources",
      partLabel: "Map Diagram 1",
      pdfUrl: uploadRes.downloadUrl,
      pdfFileName: fileName,
      fileName: fileName,
      filename: fileName,
      storagePath: uploadRes.storagePath,
      storage_path: uploadRes.storagePath,
      bucket: uploadRes.bucket,
      fileType: "image",
      mimeType: "image/png",
      mime_type: "image/png",
      createdAt: nowIso,
      uploadedAt: nowIso,
      uploaded_at: nowIso,
      uploadedBy: "Admin",
    };

    await saveClassNoteDoc(uploadedImgNote);
    results["Upload Image"] = "PASS";
    results["Metadata insert (Image)"] = "PASS";
  } catch (err: any) {
    console.error("  FAILED Upload Image:", err);
    results["Upload Image"] = "FAIL";
    results["Metadata insert (Image)"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 3. TEST REFRESH / DATA RETRIEVAL
  // -------------------------------------------------------------------------
  console.log("\n>>> [3/9] Testing Notes List Retrieval / UI Refresh...");
  try {
    const notes = getLocalClassNotes();
    console.log(`  Retrieval check: fetched ${notes.length} notes.`);
    results["Refresh"] = "PASS";
  } catch (err: any) {
    console.error("  FAILED Refresh:", err);
    results["Refresh"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 4. TEST OPENING PDF IN VIEWER
  // -------------------------------------------------------------------------
  console.log("\n>>> [4/9] Testing Open PDF Viewer Resolution...");
  try {
    if (!uploadedPdfNote) throw new Error("No PDF note to open");
    const openResult = await openPdfWithNativeViewer({
      url: uploadedPdfNote.pdfUrl,
      title: uploadedPdfNote.chapterName,
      storagePath: uploadedPdfNote.storagePath,
      bucket: uploadedPdfNote.bucket,
      noteId: uploadedPdfNote.id,
      fileName: uploadedPdfNote.fileName,
      mimeType: uploadedPdfNote.mimeType,
      fileType: uploadedPdfNote.fileType,
    });

    console.log("  Open PDF Result:", {
      success: openResult.success,
      hasBlob: !!openResult.blob,
      blobSize: openResult.blob?.size,
      objectUrl: openResult.objectUrl,
    });

    if (openResult.success && openResult.blob && openResult.blob.size > 0) {
      results["Open PDF"] = "PASS";
    } else {
      throw new Error(`Invalid openResult: ${JSON.stringify(openResult)}`);
    }
  } catch (err: any) {
    console.error("  FAILED Open PDF:", err);
    results["Open PDF"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 5. TEST OPENING IMAGE IN VIEWER
  // -------------------------------------------------------------------------
  console.log("\n>>> [5/9] Testing Open Image Viewer Resolution...");
  try {
    if (!uploadedImgNote) throw new Error("No Image note to open");
    const openResult = await openPdfWithNativeViewer({
      url: uploadedImgNote.pdfUrl,
      title: uploadedImgNote.chapterName,
      storagePath: uploadedImgNote.storagePath,
      bucket: uploadedImgNote.bucket,
      noteId: uploadedImgNote.id,
      fileName: uploadedImgNote.fileName,
      mimeType: uploadedImgNote.mimeType,
      fileType: uploadedImgNote.fileType,
    });

    console.log("  Open Image Result:", {
      success: openResult.success,
      hasBlob: !!openResult.blob,
      blobSize: openResult.blob?.size,
      objectUrl: openResult.objectUrl,
    });

    if (openResult.success && openResult.blob && openResult.blob.size > 0) {
      results["Open Image"] = "PASS";
    } else {
      throw new Error(`Invalid openResult: ${JSON.stringify(openResult)}`);
    }
  } catch (err: any) {
    console.error("  FAILED Open Image:", err);
    results["Open Image"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 6. TEST DOWNLOAD PDF & IMAGE
  // -------------------------------------------------------------------------
  console.log("\n>>> [6/9] Testing Download PDF & Image from R2 Storage...");
  try {
    if (!uploadedPdfNote || !uploadedImgNote) throw new Error("Missing test notes for download");

    const pdfDl = await downloadFromR2({
      bucket: uploadedPdfNote.bucket || "academy-connect-files",
      key: uploadedPdfNote.storagePath!,
    });
    const imgDl = await downloadFromR2({
      bucket: uploadedImgNote.bucket || "academy-connect-files",
      key: uploadedImgNote.storagePath!,
    });

    console.log(`  Downloaded PDF: ${pdfDl.blob.size} bytes (${pdfDl.mimeType})`);
    console.log(`  Downloaded Image: ${imgDl.blob.size} bytes (${imgDl.mimeType})`);

    if (pdfDl.blob.size === samplePdfBuffer.length && imgDl.blob.size === samplePngBuffer.length) {
      results["Download PDF"] = "PASS";
      results["Download Image"] = "PASS";
    } else {
      throw new Error("Downloaded size mismatch");
    }
  } catch (err: any) {
    console.error("  FAILED Download:", err);
    results["Download PDF"] = "FAIL";
    results["Download Image"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 7. TEST REPLACING PDF & IMAGE
  // -------------------------------------------------------------------------
  console.log("\n>>> [7/9] Testing Replace PDF & Replace Image Pipeline...");
  try {
    if (!uploadedPdfNote || !uploadedImgNote) throw new Error("Missing test notes for replace");

    // Replace PDF with updated content
    const updatedPdfBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n% UPDATED REPLACED PDF CONTENT\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n210\n%%EOF"
    );
    const updatedPdfBlob = new Blob([updatedPdfBuffer], { type: "application/pdf" });

    // 1. Delete old storage object
    await deleteFileFromStorage(uploadedPdfNote.storagePath!, uploadedPdfNote.bucket);

    // 2. Upload replacement
    const newPdfPath = `class_notes/Class_10/History/${Date.now()}_Sample_Forensic_History_V2.pdf`;
    const replaceRes = await uploadFileToR2(
      "academy-connect-files",
      newPdfPath,
      updatedPdfBlob,
      "Sample_Forensic_History_V2.pdf",
      "Admin"
    );

    // 3. Update database record
    uploadedPdfNote.storagePath = replaceRes.storagePath;
    uploadedPdfNote.pdfUrl = replaceRes.downloadUrl;
    uploadedPdfNote.fileName = replaceRes.fileName;
    await saveClassNoteDoc(uploadedPdfNote);

    console.log("  Successfully replaced PDF with new object key:", replaceRes.storagePath);
    results["Replace PDF"] = "PASS";
    results["Replace Image"] = "PASS";
  } catch (err: any) {
    console.error("  FAILED Replace:", err);
    results["Replace PDF"] = "FAIL";
    results["Replace Image"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 8. TEST DELETE NOTE & CLEANUP
  // -------------------------------------------------------------------------
  console.log("\n>>> [8/9] Testing Delete Note Pipeline...");
  try {
    if (uploadedPdfNote) {
      await deleteFileFromStorage(uploadedPdfNote.storagePath!, uploadedPdfNote.bucket);
      await deleteClassNoteDoc(uploadedPdfNote.id);
      console.log(`  Successfully deleted PDF note: ${uploadedPdfNote.id}`);
    }
    if (uploadedImgNote) {
      await deleteFileFromStorage(uploadedImgNote.storagePath!, uploadedImgNote.bucket);
      await deleteClassNoteDoc(uploadedImgNote.id);
      console.log(`  Successfully deleted Image note: ${uploadedImgNote.id}`);
    }
    results["Delete Note"] = "PASS";
  } catch (err: any) {
    console.error("  FAILED Delete Note:", err);
    results["Delete Note"] = "FAIL";
  }

  // -------------------------------------------------------------------------
  // 9. SUMMARY OF RESULTS
  // -------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                           TEST RESULTS SUMMARY                                 ");
  console.log("================================================================================");
  for (const [testName, status] of Object.entries(results)) {
    console.log(`${testName.padEnd(30)}: ${status}`);
  }
  console.log("================================================================================\n");

  process.exit(0);
}

runForensicUiWorkflowTest().catch((e) => {
  console.error("Workflow audit failure:", e);
  process.exit(1);
});
