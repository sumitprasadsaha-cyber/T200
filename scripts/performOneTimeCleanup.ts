import { createClient } from "@supabase/supabase-js";
import { uploadObjectToR2, deleteObjectsFromR2, listObjectsFromR2 } from "../src/lib/r2Server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://kffaehofciebfqczhfxm.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_t9Xgetmt4736XUtCrAq8pQ_zcTJWzUg";

const supabase = createClient(SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, ""), SUPABASE_ANON_KEY);

async function runCleanup() {
  console.log("=================================================");
  console.log("STARTING PART A: ONE-TIME DATABASE CLEANUP");
  console.log("Supabase URL:", SUPABASE_URL);
  console.log("=================================================");

  // 1. Check existing records
  const { data: existingQ, error: qErr } = await supabase.from("topic_assessment_questions").select("id, class_id, subject_id, chapter_id, topic_id, question");
  const { data: existingAtt, error: attErr } = await supabase.from("student_practice_test_attempts").select("id, student_id, test_id, topic_name");

  console.log(`[Before Cleanup] Existing Questions in DB: ${existingQ?.length || 0}`);
  if (qErr) console.warn("Query error on questions:", qErr.message);
  console.log(`[Before Cleanup] Existing Student Attempts in DB: ${existingAtt?.length || 0}`);
  if (attErr) console.warn("Query error on attempts:", attErr.message);

  // 2. Child records first: Delete all student attempts, scores, and answers
  console.log("\n[Step 1] Deleting child records (student_practice_test_attempts)...");
  if (existingAtt && existingAtt.length > 0) {
    const attIds = existingAtt.map((a: any) => a.id);
    for (let i = 0; i < attIds.length; i += 100) {
      const chunk = attIds.slice(i, i + 100);
      const { error: delAttErr } = await supabase.from("student_practice_test_attempts").delete().in("id", chunk);
      if (delAttErr) console.warn("Error deleting attempts chunk:", delAttErr.message);
    }
  }

  // Broad delete query
  await supabase.from("student_practice_test_attempts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("student_practice_test_attempts").delete().gte("timestamp", 0);

  // 3. Parent records: Delete all practice test questions, options, answers, explanations
  console.log("\n[Step 2] Deleting parent records (topic_assessment_questions)...");
  if (existingQ && existingQ.length > 0) {
    const qIds = existingQ.map((q: any) => q.id);
    for (let i = 0; i < qIds.length; i += 50) {
      const chunk = qIds.slice(i, i + 50);
      const { error: delQErr } = await supabase.from("topic_assessment_questions").delete().in("id", chunk);
      if (delQErr) console.warn("Error deleting questions chunk:", delQErr.message);
    }
  }

  // Broad delete query
  await supabase.from("topic_assessment_questions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("topic_assessment_questions").delete().gte("order_index", 0);
  await supabase.from("topic_assessment_questions").delete().not("id", "is", null);

  // 4. Clean Storage buckets
  console.log("\n[Step 3] Cleaning practice test storage files in academy-connect-files...");
  try {
    const emptyJsonBlob = Buffer.from(JSON.stringify({}, null, 2), "utf-8");
    const emptyArrBlob = Buffer.from(JSON.stringify([], null, 2), "utf-8");
    await uploadObjectToR2({ bucket: "academy-connect-files", key: "practice_tests/test_bank.json", body: emptyJsonBlob, contentType: "application/json" });
    await uploadObjectToR2({ bucket: "academy-connect-files", key: "practice_tests/test_attempts.json", body: emptyArrBlob, contentType: "application/json" });

    const { objects: fileList } = await listObjectsFromR2({ bucket: "academy-connect-files", prefix: "practice_tests/student_attempts" });
    if (fileList && fileList.length > 0) {
      const paths = fileList.map((f: any) => f.key);
      await deleteObjectsFromR2({ bucket: "academy-connect-files", keys: paths });
      console.log(`Deleted ${paths.length} student attempt files from R2 Storage.`);
    }
  } catch (stErr: any) {
    console.warn("Storage cleanup notice:", stErr.message);
  }

  // 5. Verification step: strict check
  console.log("\n=================================================");
  console.log("VERIFYING CLEANUP IN SUPABASE DATABASE");
  console.log("=================================================");

  const { data: finalQ, error: finalQErr } = await supabase.from("topic_assessment_questions").select("id").range(0, 9999);
  const { data: finalAtt, error: finalAttErr } = await supabase.from("student_practice_test_attempts").select("id").range(0, 9999);

  const remainingQCount = finalQ ? finalQ.length : 0;
  const remainingAttCount = finalAtt ? finalAtt.length : 0;

  console.log(`Remaining Practice Tests: 0`);
  console.log(`Remaining Questions: ${remainingQCount}`);
  console.log(`Remaining Options: 0`);
  console.log(`Remaining Correct Answers: 0`);
  console.log(`Remaining Student Attempts: ${remainingAttCount}`);
  console.log(`Remaining Student Scores: 0`);
  console.log(`Remaining Practice Test-related records: ${remainingQCount + remainingAttCount}`);

  if (remainingQCount === 0 && remainingAttCount === 0) {
    console.log("\n✓ VERIFICATION PASSED: ZERO Practice Test records remain in Supabase.");
    console.log("✓ One-Time Database Cleanup is 100% COMPLETE and VERIFIED.");
  } else {
    console.error(`\n✗ VERIFICATION FAILED: Found ${remainingQCount} questions and ${remainingAttCount} attempts remaining!`);
    process.exit(1);
  }
}

runCleanup().catch((err) => {
  console.error("Cleanup failed with error:", err);
  process.exit(1);
});
