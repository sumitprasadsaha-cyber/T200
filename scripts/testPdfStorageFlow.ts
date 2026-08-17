import { strict as assert } from "node:assert";
import { getBucketName, getResolvedViewUrl, uploadPdfToStorage } from "../src/lib/storageService";
import { supabase } from "../src/lib/supabaseClient";

async function main() {
  const studentId = "student-1784378546110";
  const subject = "Mathematics";
  const bucket = getBucketName();

  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "utf8");
  const file = new File([pdfBytes], "1784760657941-Chapter1.pdf", {
    type: "application/pdf",
  });

  console.log("[PDF Flow Test] Step 1: Uploading PDF sample to Supabase Storage...");
  const metadataJson = await uploadPdfToStorage(studentId, subject, file.name, file);
  const metadata = JSON.parse(metadataJson);

  assert.equal(metadata.storageProvider, "supabase");
  assert.equal(metadata.bucket, bucket);
  assert.ok(metadata.storagePath, "metadata.storagePath must be present");
  assert.ok(metadata.storagePath.startsWith("notes/"), "storagePath should be a relative storage object path");
  assert.equal(metadata.fileName, file.name);
  assert.equal(metadata.fileSize, file.size);
  assert.equal(metadata.mimeType, "application/pdf");

  console.log("[PDF Flow Test] Step 2: Validating metadata object path...");
  const objectPath = metadata.storagePath;
  assert.ok(!objectPath.startsWith("blob:"));
  assert.ok(!objectPath.startsWith("file://"));
  assert.ok(!objectPath.includes("localhost"));
  assert.ok(!objectPath.includes("temporary"));
  assert.ok(!objectPath.includes("/tmp/"));

  console.log("[PDF Flow Test] Step 3: Resolving stored object to a browser URL...");
  const resolvedUrl = await getResolvedViewUrl(bucket, objectPath);
  assert.ok(resolvedUrl.length > 0, "resolvedUrl should not be empty");
  assert.ok(!resolvedUrl.startsWith("blob:"), "resolvedUrl should be an HTTPS or signed URL, not blob:");

  console.log("[PDF Flow Test] Step 4: Downloading the object via Supabase Storage API...");
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  assert.equal(error, null);
  assert.ok(data instanceof Blob, "downloaded data should be a Blob");
  assert.equal(data.type, "application/pdf");
  assert.equal(data.size, file.size);

  console.log("[PDF Flow Test] Step 5: Confirming viewer-ready object data...");
  assert.ok(data.size > 0, "downloaded PDF should not be empty");
  assert.ok(data.type === "application/pdf", "downloaded MIME type must be application/pdf");

  console.log("[PDF Flow Test] PASS");
  console.log(JSON.stringify({
    bucket,
    objectPath,
    resolvedUrl,
    downloadedSize: data.size,
    uploadedSize: file.size,
    mimeType: data.type,
  }, null, 2));
}

main().catch((err) => {
  console.error("[PDF Flow Test] FAIL");
  console.error(err);
  process.exit(1);
});
