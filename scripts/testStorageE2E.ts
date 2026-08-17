import { createClient } from "@supabase/supabase-js";

// Clean environment Supabase URL
const rawUrl = process.env.VITE_SUPABASE_URL || "";
const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
const key = process.env.VITE_SUPABASE_ANON_KEY || "";
const bucket = "academy-connect-files";

console.log("=== SUPABASE STORAGE END-TO-END TEST ===");
console.log(`- Base URL: "${cleanUrl}"`);
console.log(`- Bucket: "${bucket}"`);

const supabase = createClient(cleanUrl, key);

async function runE2ETest() {
  const timestamp = Date.now();
  const testStudentId = "test_student_e2e";
  const fileName = "chapter_1_algebra.pdf";
  const relativePath = `notes/${testStudentId}/${timestamp}-${fileName}`;

  // 1. Prepare dummy PDF Blob
  const pdfHeader = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
  const blob = new Blob([pdfHeader], { type: "application/pdf" });
  const buffer = Buffer.from(await blob.arrayBuffer());

  console.log(`\n[STEP 1] Uploading test PDF to "${bucket}/${relativePath}"...`);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(relativePath, buffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    console.error("[STEP 1 FAILED] Upload Error:", uploadError);
    process.exit(1);
  }

  console.log("[STEP 1 SUCCESS] Upload response path:", uploadData?.path);

  // 2. Verify file listing in storage bucket
  console.log(`\n[STEP 2] Verifying file exists in bucket "${bucket}" under "notes/${testStudentId}"...`);
  const { data: listData, error: listError } = await supabase.storage
    .from(bucket)
    .list(`notes/${testStudentId}`);

  if (listError) {
    console.error("[STEP 2 FAILED] List Error:", listError);
    process.exit(1);
  }

  const found = listData?.some((f) => uploadData?.path.endsWith(f.name));
  console.log(`[STEP 2 RESULT] File found in bucket listing: ${found}`);
  if (!found) {
    console.error("[STEP 2 FAILED] File not present in bucket listing!");
    process.exit(1);
  }

  // 3. Resolve Fresh Signed URL
  console.log(`\n[STEP 3] Generating fresh signed URL for "${relativePath}"...`);
  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(relativePath, 3600);

  if (signedError || !signedData?.signedUrl) {
    console.error("[STEP 3 FAILED] Signed URL Generation Error:", signedError);
    process.exit(1);
  }

  console.log(`[STEP 3 SUCCESS] Generated Signed URL: ${signedData.signedUrl.substring(0, 80)}...`);

  // 4. Download / Fetch PDF content using Signed URL
  console.log(`\n[STEP 4] Fetching PDF content via generated signed URL...`);
  const fetchRes = await fetch(signedData.signedUrl);
  console.log(`[STEP 4 RESULT] HTTP Status: ${fetchRes.status} ${fetchRes.statusText}`);

  if (fetchRes.status !== 200) {
    console.error(`[STEP 4 FAILED] HTTP ${fetchRes.status} returned when accessing signed URL!`);
    process.exit(1);
  }

  const downloadedText = await fetchRes.text();
  if (!downloadedText.includes("%PDF-1.4")) {
    console.error("[STEP 4 FAILED] Downloaded content is not valid PDF!");
    process.exit(1);
  }

  console.log("[STEP 4 SUCCESS] Downloaded PDF header verified successfully!");

  // 5. Delete file from Storage
  console.log(`\n[STEP 5] Deleting file "${relativePath}" from bucket "${bucket}"...`);
  const { data: removeData, error: removeError } = await supabase.storage
    .from(bucket)
    .remove([relativePath]);

  if (removeError) {
    console.error("[STEP 5 FAILED] Remove Error:", removeError);
    process.exit(1);
  }

  console.log("[STEP 5 SUCCESS] Remove response:", removeData);

  console.log("\n=========================================");
  console.log("=== ALL END-TO-END TESTS PASSED 100% ===");
  console.log("=========================================\n");
}

runE2ETest().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
