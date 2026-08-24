import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function run() {
  console.log("=== STARTING NOTES MANAGEMENT E2E UI TEST ===");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]:`, msg.text());
  });

  page.on("requestfailed", (req) => {
    console.log(`[REQUEST FAILED]: ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      console.log(`[API RESPONSE]: ${res.status()} ${res.url()}`);
      try {
        const text = await res.text();
        console.log(`[API RESPONSE BODY]:`, text.substring(0, 400));
      } catch {}
    }
  });

  // Pre-seed authenticated admin session
  await page.addInitScript(() => {
    const adminSession = {
      uid: "admin_tester_id",
      email: "sumitprasadsaha@gmail.com",
      role: "admin",
      studentId: null,
    };
    localStorage.setItem("tuition_auth_session", JSON.stringify(adminSession));
    localStorage.setItem("tuition_active_role", "admin");
    localStorage.setItem("tuition_users", JSON.stringify({
      "admin_tester_id": {
        uid: "admin_tester_id",
        email: "sumitprasadsaha@gmail.com",
        role: "Admin",
        status: "Active"
      }
    }));
  });

  try {
    console.log("Navigating to http://localhost:3000 ...");
    await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    console.log("Current page title:", await page.title());

    // Click on "Notes" tab in header/nav
    console.log("Looking for Notes button/tab...");
    const notesTab = await page.$("button:has-text('Notes'), a:has-text('Notes'), [data-tab='Notes']");
    if (notesTab) {
      await notesTab.click();
      console.log("Clicked Notes tab successfully.");
    } else {
      console.log("Notes tab not found directly. Finding all buttons...");
      const btns = await page.$$eval("button", (b) => b.map((x) => x.textContent?.trim()));
      console.log(btns);
    }

    await page.waitForTimeout(2000);

    // Look for "Upload Note" button
    console.log("Looking for Upload Note button...");
    const uploadBtn = await page.$("button:has-text('Upload Note'), button:has-text('Upload'), button:has-text('Add Note')");
    if (uploadBtn) {
      console.log("Found Upload Note button. Clicking it...");
      await uploadBtn.click();
    } else {
      console.log("Upload Note button not found, buttons on page:");
      const btns = await page.$$eval("button", (b) => b.map((x) => x.textContent?.trim()));
      console.log(btns);
    }

    await page.waitForTimeout(1000);

    // Create a real sample PDF file for test
    const testPdfPath = path.join(process.cwd(), "test_study_note.pdf");
    fs.writeFileSync(testPdfPath, "%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");

    console.log("Filling form fields in modal...");

    // Class selection
    const selects = await page.$$("select");
    console.log(`Found ${selects.length} select dropdowns.`);
    if (selects.length > 0) {
      const classSelect = selects[0];
      const opts = await classSelect.$$eval("option", (o) => o.map((x) => x.value));
      console.log("Class options:", opts);
      if (opts.includes("Class 10")) {
        await classSelect.selectOption("Class 10");
      } else if (opts.length > 1) {
        await classSelect.selectOption(opts[1]);
      }
    }

    // Select Subject
    if (selects.length > 1) {
      const subjectSelect = selects[1];
      const subjOpts = await subjectSelect.$$eval("option", (o) => o.map((x) => x.value));
      console.log("Subject options:", subjOpts);
      if (subjOpts.length > 0) {
        await subjectSelect.selectOption(subjOpts[0]);
      }
    }

    // Fill Chapter No & Chapter Title
    const numberInputs = await page.$$("input[type='number']");
    if (numberInputs.length > 0) {
      await numberInputs[0].fill("1");
    }

    const titleInput = await page.$("input[placeholder*='Title'], input[placeholder*='Module Name'], input[placeholder*='Chapter']");
    if (titleInput) {
      await titleInput.fill("Real Numbers & Polynomials");
    }

    // Upload file
    const fileInput = await page.$("input[type='file']");
    if (fileInput) {
      console.log("Attaching PDF file to input...");
      await fileInput.setInputFiles(testPdfPath);
    }

    await page.waitForTimeout(500);

    // Click Save & Upload
    console.log("Clicking Save & Upload button...");
    const submitBtn = await page.$("button:has-text('Save & Upload'), button:has-text('Upload Note')");
    if (submitBtn) {
      await submitBtn.click();
      console.log("Clicked Submit button.");
    }

    // Wait 5 seconds for upload and state change
    console.log("Waiting for upload response and UI state update...");
    await page.waitForTimeout(5000);

    // Check for errors
    const errorElem = await page.$(".text-red-500, .text-rose-500, .text-red-600, .bg-red-50, .border-red-300");
    if (errorElem) {
      const errText = await errorElem.textContent();
      console.log(">>> [ERROR DETECTED IN MODAL]:", errText);
    } else {
      console.log(">>> [NO ERROR ELEMENT DETECTED]");
    }

    const successElem = await page.$(".text-green-500, .text-emerald-500, .text-green-600, .bg-green-50");
    if (successElem) {
      const succText = await successElem.textContent();
      console.log(">>> [SUCCESS DETECTED IN MODAL]:", succText);
    }

    // Check if the new note appears in the hierarchy/list
    const noteHeading = await page.$("text=Real Numbers & Polynomials");
    console.log(">>> Note appears in hierarchy:", Boolean(noteHeading));

  } catch (err) {
    console.error("Test execution error:", err);
  } finally {
    await browser.close();
  }
}

run();
