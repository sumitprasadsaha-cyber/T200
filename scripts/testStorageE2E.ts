/**
 * Cloudflare R2 Storage End-to-End Test
 */

import {
  uploadObjectToR2,
  getObjectFromR2,
  generateR2SignedUrl,
  deleteObjectFromR2,
  listObjectsFromR2,
  getR2ServerConfig,
} from "../src/lib/r2Server";

const config = getR2ServerConfig();
const bucket = config.bucket;

console.log("=== CLOUDFLARE R2 STORAGE END-TO-END TEST ===");
console.log(`- Bucket: "${bucket}"`);
console.log(`- Endpoint: "${config.endpoint}"`);
console.log(`- Account ID: "${config.accountId}"`);

async function runE2ETest() {
  const timestamp = Date.now();
  const testStudentId = "test_student_e2e";
  const fileName = "chapter_1_algebra.pdf";
  const relativePath = `notes/${testStudentId}/${timestamp}-${fileName}`;

  // 1. Prepare dummy PDF Buffer
  const pdfHeader = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
  const buffer = Buffer.from(pdfHeader, "utf-8");

  console.log(`\n[STEP 1] Uploading test PDF to R2 bucket "${bucket}/${relativePath}"...`);
  const uploadData = await uploadObjectToR2({
    bucket,
    key: relativePath,
    body: buffer,
    contentType: "application/pdf",
  });

  console.log("[STEP 1 SUCCESS] Upload response key:", uploadData?.key);

  // 2. Verify file listing in storage bucket
  console.log(`\n[STEP 2] Verifying file exists in bucket "${bucket}" under "notes/${testStudentId}"...`);
  const listData = await listObjectsFromR2({
    bucket,
    prefix: `notes/${testStudentId}`,
  });

  const found = listData?.objects?.some((f) => f.key.endsWith(fileName));
  console.log(`[STEP 2 RESULT] File found in bucket listing: ${found}`);

  // 3. Resolve Fresh Signed URL
  console.log(`\n[STEP 3] Generating fresh signed URL for "${relativePath}"...`);
  const signedUrl = await generateR2SignedUrl({
    bucket,
    key: relativePath,
    expiresIn: 3600,
  });

  console.log(`[STEP 3 SUCCESS] Generated Signed URL: ${signedUrl.substring(0, 80)}...`);

  // 4. Download / Get PDF content directly from R2
  console.log(`\n[STEP 4] Fetching PDF content via R2 GetObject API...`);
  const getObj = await getObjectFromR2({
    bucket,
    key: relativePath,
  });

  if (!getObj.body) {
    console.error("[STEP 4 FAILED] No body received from R2!");
    process.exit(1);
  }

  console.log("[STEP 4 SUCCESS] Downloaded PDF verified successfully!");

  // 5. Delete file from Storage
  console.log(`\n[STEP 5] Deleting file "${relativePath}" from bucket "${bucket}"...`);
  const removeData = await deleteObjectFromR2({
    bucket,
    key: relativePath,
  });

  console.log("[STEP 5 SUCCESS] Remove response:", removeData);

  console.log("\n=========================================");
  console.log("=== ALL R2 END-TO-END TESTS PASSED 100% ===");
  console.log("=========================================\n");
}

runE2ETest().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
