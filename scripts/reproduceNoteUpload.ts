import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function run() {
  console.log("=== STARTING NOTES MANAGEMENT UPLOAD REPRODUCTION TEST ===");

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
        console.log(`[API BODY]:`, text.substring(0, 300));
      } catch {}
    }
  });

  try {
    console.log("Navigating to http://localhost:3000 ...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

    // Check if on login page
    const loginHeading = await page.$("text=Sumit Tuition");
    console.log("Page loaded. Looking for Admin login button...");

    // Click Admin role button or input
    const adminBtn = await page.$("button:has-text('Admin')");
    if (adminBtn) {
      console.log("Clicking Admin role button...");
      await adminBtn.click();
    }

    // Fill password if required
    const passInput = await page.$("input[type='password']");
    if (passInput) {
      console.log("Entering admin passcode...");
      await passInput.fill("123456");
    }

    const submitLogin = await page.$("button[type='submit']");
    if (submitLogin) {
      console.log("Submitting login form...");
      await submitLogin.click();
    }

    await page.waitForTimeout(2000);

    // Look for Notes navigation tab
    console.log("Navigating to Notes Management...");
    const notesTab = await page.$("button:has-text('Notes'), a:has-text('Notes'), span:has-text('Notes')");
    if (notesTab) {
      await notesTab.click();
    } else {
      console.log("Notes tab not found directly, looking for all buttons...");
      const buttons = await page.$$eval("button", (btns) => btns.map((b) => b.textContent?.trim()));
      console.log("Buttons found:", buttons);
    }

    await page.waitForTimeout(2000);

    // Look for Upload Note / Add Note button
    console.log("Looking for Upload Note button...");
    const uploadBtn = await page.$("button:has-text('Upload Note'), button:has-text('Upload'), button:has-text('Add Note')");
    if (uploadBtn) {
      console.log("Clicking Upload Note button...");
      await uploadBtn.click();
    }

    await page.waitForTimeout(1000);

    // Create a dummy PDF file for testing
    const testPdfPath = path.join(process.cwd(), "test_sample_note.pdf");
    fs.writeFileSync(testPdfPath, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");

    // Fill the upload modal form
    console.log("Filling Upload Form...");

    // Class select
    const classSelect = await page.$("select");
    if (classSelect) {
      const options = await classSelect.$$eval("option", (opts) => opts.map((o) => o.value));
      console.log("Class options:", options);
      if (options.length > 0) {
        await classSelect.selectOption(options[1] || options[0]);
      }
    }

    // Subject input or select
    const textInputs = await page.$$("input[type='text'], input[type='number']");
    console.log(`Found ${textInputs.length} text/number inputs`);

    for (const input of textInputs) {
      const placeholder = await input.getAttribute("placeholder");
      const name = await input.getAttribute("name");
      console.log(`Input placeholder: "${placeholder}", name: "${name}"`);
    }

    // Module / Chapter inputs
    const numInput = await page.$("input[type='number']");
    if (numInput) {
      await numInput.fill("1");
    }

    const titleInput = await page.$("input[placeholder*='Title'], input[placeholder*='Name'], input[placeholder*='Module']");
    if (titleInput) {
      await titleInput.fill("Introduction to Polity");
    }

    // File input
    const fileInput = await page.$("input[type='file']");
    if (fileInput) {
      console.log("Setting test PDF file...");
      await fileInput.setInputFiles(testPdfPath);
    }

    await page.waitForTimeout(1000);

    // Submit upload
    console.log("Submitting Note Upload...");
    const saveBtn = await page.$("button:has-text('Save & Upload'), button:has-text('Upload Note'), button:has-text('Save')");
    if (saveBtn) {
      await saveBtn.click();
    }

    // Wait for response or error
    await page.waitForTimeout(4000);

    // Check for errors or success
    const errorElem = await page.$(".text-red-500, .text-rose-500, .text-red-600, .bg-red-50");
    if (errorElem) {
      const errText = await errorElem.textContent();
      console.log("[REPRODUCED FORM ERROR]:", errText);
    }

    const successElem = await page.$(".text-green-500, .text-emerald-500, .text-green-600");
    if (successElem) {
      const succText = await successElem.textContent();
      console.log("[SUCCESS MESSAGE]:", succText);
    }

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await browser.close();
  }
}

run();
