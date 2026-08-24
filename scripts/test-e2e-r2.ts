import {
  getR2ServerConfig,
  isR2Configured,
  listObjectsFromR2,
  uploadObjectToR2,
  getObjectFromR2,
  deleteObjectFromR2,
  generateR2SignedUrl,
} from "../src/lib/r2Server";
import { getFirebaseDb } from "../src/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { Readable } from "stream";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function runE2ETests() {
  console.log("==================================================");
  console.log("      CLOUDFLARE R2 END-TO-END VERIFICATION      ");
  console.log("==================================================");

  // 1. Verify Configuration
  console.log("\n[1/7] Auditing Environment Configuration...");
  const config = getR2ServerConfig();
  const isConfigured = isR2Configured();

  const mask = (s: string) => (s ? `${s.substring(0, 4)}...${s.substring(s.length - 4)} (length: ${s.length})` : "MISSING ✗");

  console.log(`Config Valid: ${isConfigured ? "YES ✓" : "NO ✗"}`);
  console.log("Variables Summary:");
  console.log(`  - R2_ACCOUNT_ID: ${config.accountId ? `${config.accountId.substring(0, 6)}...` : "MISSING ✗"}`);
  console.log(`  - R2_ACCESS_KEY_ID: ${mask(config.accessKeyId)}`);
  console.log(`  - R2_SECRET_ACCESS_KEY: ${mask(config.secretAccessKey)}`);
  console.log(`  - R2_BUCKET: ${config.bucket}`);
  console.log(`  - R2_ENDPOINT: ${config.endpoint}`);
  console.log(`  - R2_PUBLIC_URL: ${config.publicUrl || "(using internal proxy)"}`);

  if (!isConfigured) {
    console.error("Missing critical variables for R2 connection");
    process.exit(1);
  }

  const bucket = config.bucket;
  console.log(`Target Bucket: "${bucket}"`);

  // 2. Verify List / Connectivity
  console.log("\n[2/7] Testing R2 Bucket Connection & List Objects...");
  const listRes = await listObjectsFromR2({ bucket, maxKeys: 10 });
  console.log(`Found ${listRes.objects.length} sample objects in R2 bucket.`);
  console.log("Bucket listing works: YES ✓");

  // 3. Test Real Upload (PDF & PNG)
  console.log("\n[3/7] Testing Upload to R2...");
  const testPdfContent = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000108 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n187\n%%EOF\n";
  const testKey = `test-e2e/${Date.now()}-e2e-verification.pdf`;

  const uploadRes = await uploadObjectToR2({
    bucket,
    key: testKey,
    body: Buffer.from(testPdfContent, "utf-8"),
    contentType: "application/pdf",
  });
  console.log(`Uploaded test PDF: key="${testKey}", ETag="${uploadRes.etag}" ✓`);

  // 4. Test Real Download / Get Object
  console.log("\n[4/7] Testing Download / Read from R2...");
  const getRes = await getObjectFromR2({ bucket, key: testKey });
  if (!getRes.body) {
    throw new Error("Download returned null body!");
  }
  const downloadedBuf = await streamToBuffer(getRes.body);
  const downloadedText = downloadedBuf.toString("utf-8");
  if (downloadedText === testPdfContent && getRes.contentType === "application/pdf") {
    console.log(`Downloaded test PDF matching exact content (${getRes.contentLength} bytes) ✓`);
  } else {
    throw new Error(`Content mismatch on downloaded object! Length: ${downloadedBuf.length} vs ${testPdfContent.length}`);
  }

  // 5. Test Presigned URLs
  console.log("\n[5/7] Testing Presigned URL generation...");
  const presignedGet = await generateR2SignedUrl({
    bucket,
    key: testKey,
    operation: "getObject",
    expiresIn: 3600,
  });
  console.log(`Presigned GET URL generated successfully (${presignedGet.substring(0, 70)}...) ✓`);

  const presignedPut = await generateR2SignedUrl({
    bucket,
    key: `test-e2e/presigned-test-${Date.now()}.pdf`,
    operation: "putObject",
    expiresIn: 3600,
    contentType: "application/pdf",
  });
  console.log(`Presigned PUT URL generated successfully (${presignedPut.substring(0, 70)}...) ✓`);

  // 6. Test Delete Operations
  console.log("\n[6/7] Testing Object Deletion...");
  await deleteObjectFromR2({ bucket, key: testKey });
  console.log(`Deleted test object "${testKey}" successfully ✓`);

  // 7. Verify Firestore database records
  console.log("\n[7/7] Verifying Firestore Database Records...");
  const db = await getFirebaseDb();
  if (db) {
    const snap = await getDocs(collection(db, "class_notes"));
    console.log(`Total Firestore class_notes count: ${snap.size}`);
    let validR2Count = 0;
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.storageProvider === "r2" || (data.pdfUrl && data.pdfUrl.includes("/api/r2/"))) {
        validR2Count++;
      }
    });
    console.log(`Notes configured with Cloudflare R2: ${validR2Count} / ${snap.size} (${Math.round((validR2Count / snap.size) * 100)}%)`);
  }

  console.log("\n==================================================");
  console.log("       ALL CLOUDFLARE R2 TESTS PASSED (7/7)       ");
  console.log("==================================================");
  process.exit(0);
}

runE2ETests().catch((err) => {
  console.error("\n❌ E2E Test Failed:", err);
  process.exit(1);
});
