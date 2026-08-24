import { strict as assert } from "node:assert";
import { getBucketName, getResolvedViewUrl, uploadFileToR2 } from "../src/lib/storageService";
import { uploadObjectToR2, getObjectFromR2, generateR2SignedUrl, deleteObjectFromR2 } from "../src/lib/r2Server";

async function main() {
  const studentId = "student-1784378546110";
  const bucket = getBucketName();

  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF", "utf8");
  const fileName = "1784760657941-Chapter1.pdf";
  const objectPath = `notes/${studentId}/${Date.now()}-${fileName}`;

  console.log("[PDF Flow Test] Step 1: Uploading PDF sample to Cloudflare R2...");
  const uploadRes = await uploadObjectToR2({
    bucket,
    key: objectPath,
    body: pdfBytes,
    contentType: "application/pdf",
  });

  assert.equal(uploadRes.bucket, bucket);
  assert.equal(uploadRes.key, objectPath);

  console.log("[PDF Flow Test] Step 2: Generating Signed URL...");
  const signedUrl = await generateR2SignedUrl({
    bucket,
    key: objectPath,
    expiresIn: 3600,
  });

  assert.ok(signedUrl.length > 0, "signedUrl should not be empty");

  console.log("[PDF Flow Test] Step 3: Fetching the object via R2 GetObject...");
  const getRes = await getObjectFromR2({
    bucket,
    key: objectPath,
  });
  assert.ok(getRes.body, "getRes.body should be present");
  // Consume stream
  for await (const _ of getRes.body) {}

  console.log("[PDF Flow Test] Step 4: Deleting test object from R2...");
  await deleteObjectFromR2({
    bucket,
    key: objectPath,
  });

  console.log("[PDF Flow Test] PASS - Cloudflare R2 PDF Flow verified successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[PDF Flow Test] FAIL");
  console.error(err);
  process.exit(1);
});
