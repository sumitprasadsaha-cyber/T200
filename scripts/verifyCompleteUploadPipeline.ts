import { uploadFileToR2, deleteFileFromStorage, getResolvedViewUrl } from "../src/lib/storageService";
import { uploadObjectToR2, getObjectFromR2, deleteObjectFromR2, listObjectsFromR2 } from "../src/lib/r2Server";
import { generateUPSCStoragePath } from "../src/utils/classNoteHelper";
import fs from "fs";
import path from "path";

async function runEndToEndVerification() {
  console.log("===============================================================");
  console.log("=== STARTING FULL END-TO-END CLOUDFLARE R2 UPLOAD TEST =======");
  console.log("===============================================================");

  const bucket = "academy-connect-files";
  const timestamp = Date.now();

  // -------------------------------------------------------------
  // TEST 1: Standard Class 10 PDF Study Note Upload to R2
  // -------------------------------------------------------------
  console.log("\n[TEST 1] Uploading Standard Class 10 Mathematics PDF Note...");
  const pdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
  );
  const pdfKey = `class_notes/Class_10/Mathematics/${timestamp}_Topic_1_Real_Numbers.pdf`;

  console.log(`Uploading to R2: bucket="${bucket}", key="${pdfKey}"`);
  const pdfUploadRes = await uploadObjectToR2({
    bucket,
    key: pdfKey,
    body: pdfBuffer,
    contentType: "application/pdf",
  });
  console.log("[TEST 1 Result] Uploaded PDF:", pdfUploadRes);

  // Verify object in R2
  console.log("Verifying PDF exists in Cloudflare R2 bucket...");
  const fetchedPdf = await getObjectFromR2({ bucket, key: pdfKey });
  if (!fetchedPdf.body) {
    throw new Error(`[TEST 1 FAILED] Could not fetch uploaded PDF from R2: ${pdfKey}`);
  }
  console.log(`[TEST 1 SUCCESS] Retrieved PDF from R2: ContentLength=${fetchedPdf.contentLength}, ContentType=${fetchedPdf.contentType}`);

  // -------------------------------------------------------------
  // TEST 2: UPSC GS Paper II International Relations Note Upload
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Uploading UPSC GS Paper II Note using generateUPSCStoragePath...");
  const upscInfo = generateUPSCStoragePath(
    "General Studies Paper II",
    "International Relations",
    1,
    "India and its Neighborhood Relations",
    "1.1",
    "India-Bhutan Bilateral Ties",
    "india_bhutan.pdf",
    "pdf"
  );
  console.log("Generated UPSC path info:", upscInfo);

  const upscBuffer = Buffer.from("%PDF-1.4 UPSC GS Paper II Note Content for verification");
  const upscUploadRes = await uploadObjectToR2({
    bucket,
    key: upscInfo.storagePath,
    body: upscBuffer,
    contentType: "application/pdf",
  });
  console.log("[TEST 2 Result] Uploaded UPSC note to R2:", upscUploadRes);

  const fetchedUpsc = await getObjectFromR2({ bucket, key: upscInfo.storagePath });
  if (!fetchedUpsc.body) {
    throw new Error(`[TEST 2 FAILED] Could not fetch uploaded UPSC note from R2: ${upscInfo.storagePath}`);
  }
  console.log(`[TEST 2 SUCCESS] Verified UPSC note in R2: key="${upscInfo.storagePath}", ContentType=${fetchedUpsc.contentType}`);

  // -------------------------------------------------------------
  // TEST 3: Image Note Upload (.png / .jpg)
  // -------------------------------------------------------------
  console.log("\n[TEST 3] Uploading Class 9 Science Image Diagram Note (.png)...");
  // 1x1 PNG transparent pixel
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const imgKey = `class_notes/Class_9/Science/${timestamp}_Cell_Structure_Diagram.png`;

  const imgUploadRes = await uploadObjectToR2({
    bucket,
    key: imgKey,
    body: pngBuffer,
    contentType: "image/png",
  });
  console.log("[TEST 3 Result] Uploaded Image Note to R2:", imgUploadRes);

  const fetchedImg = await getObjectFromR2({ bucket, key: imgKey });
  if (!fetchedImg.body) {
    throw new Error(`[TEST 3 FAILED] Could not fetch uploaded Image from R2: ${imgKey}`);
  }
  console.log(`[TEST 3 SUCCESS] Verified Image Note in R2: key="${imgKey}", ContentType=${fetchedImg.contentType}`);

  // -------------------------------------------------------------
  // TEST 4: List Objects from Cloudflare R2 Bucket
  // -------------------------------------------------------------
  console.log("\n[TEST 4] Listing objects from Cloudflare R2 bucket with prefix 'class_notes/Class_10/'...");
  const listRes = await listObjectsFromR2({
    bucket,
    prefix: "class_notes/Class_10/",
    maxKeys: 10,
  });
  console.log(`[TEST 4 SUCCESS] Listed ${listRes.objects.length} objects in Cloudflare R2:`);
  for (const obj of listRes.objects.slice(0, 5)) {
    console.log(`  - ${obj.key} (${obj.size} bytes)`);
  }

  // -------------------------------------------------------------
  // TEST 5: Clean Up Test Artifacts
  // -------------------------------------------------------------
  console.log("\n[TEST 5] Cleaning up test artifacts from Cloudflare R2...");
  await deleteObjectFromR2({ bucket, key: pdfKey });
  await deleteObjectFromR2({ bucket, key: upscInfo.storagePath });
  await deleteObjectFromR2({ bucket, key: imgKey });
  console.log("[TEST 5 SUCCESS] Cleaned up test artifacts successfully.");

  console.log("\n===============================================================");
  console.log("=== ALL END-TO-END PIPELINE TESTS PASSED SUCCESSFULLY! =======");
  console.log("===============================================================");
}

runEndToEndVerification().catch((err) => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
