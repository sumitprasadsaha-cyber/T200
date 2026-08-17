import { jsPDF } from "jspdf";
import { Student } from "../types";
import { isFutureMonth, hasAttendedInMonth } from "../components/StudentList";
import { saveAndOpenGeneratedPdf } from "../lib/nativePdfService";
import { getEvaluatedFeeStatus } from "./feeBillingHelper";

// Generate a list of the 12 months for an April-to-March session
export function getSessionMonths(startYear: number): string[] {
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  const months: string[] = [];
  
  // April (m=3) to December (m=11) of startYear
  for (let m = 3; m < 12; m++) {
    months.push(`${monthNames[m]} ${startYear}`);
  }
  // January (m=0) to March (m=2) of next year
  for (let m = 0; m <= 2; m++) {
    months.push(`${monthNames[m]} ${startYear + 1}`);
  }
  
  return months;
}

// Check if a specific month is overdue based on current time
// Overdue if unpaid after 3rd of the next month at 1:00 PM
export function isMonthOverdue(monthYearStr: string, currentDateTime: Date = new Date()): boolean {
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  const [monthName, yearStr] = monthYearStr.split(" ");
  const monthIndex = monthNames.indexOf(monthName);
  const year = parseInt(yearStr);
  
  if (monthIndex === -1 || isNaN(year)) return false;
  
  let nextMonthIdx = monthIndex + 1;
  let nextMonthYear = year;
  if (nextMonthIdx > 11) {
    nextMonthIdx = 0;
    nextMonthYear = year + 1;
  }
  
  // Deadline is 3rd of next month at 1:00 PM
  const deadline = new Date(nextMonthYear, nextMonthIdx, 3, 13, 0, 0);
  return currentDateTime > deadline;
}

// Formats date string from input type date "YYYY-MM-DD" to "DD/MM/YYYY"
export function formatDisplayDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  if (dateStr.includes("/")) return dateStr; // already formatted
  
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

interface MonthStudentReportRow {
  name: string;
  classGrade: string;
  feeStatus: "Paid" | "Unpaid" | "Partial";
  amountPaid: number;
  amountDue: number;
}

interface MonthDetailSummary {
  monthStr: string;
  targetRevenue: number;
  collectedRevenue: number;
  duesAmount: number;
  paidCount: number;
  unpaidCount: number;
  allStudents: MonthStudentReportRow[];
}

// Generate the Comprehensive Annual PDF Report (Summary + Full Month-by-Month Reports)
export async function generateAnnualReport(startYear: number, students: Student[]) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const sessionMonths = getSessionMonths(startYear);
  const sessionLabel = `April ${startYear} - March ${startYear + 1}`;
  const instName = localStorage.getItem("tuition_institution_name") || "Sumit Tuition App";

  let totalSessionRevenue = 0;
  let totalSessionDues = 0;
  let totalSessionTarget = 0;
  let activeStudentCount = 0;

  const monthlySummaries: MonthDetailSummary[] = [];

  sessionMonths.forEach((monthStr) => {
    const [mName, yStr] = monthStr.split(" ");
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const mIdx = monthNames.indexOf(mName);
    const year = parseInt(yStr) || startYear;

    let monthTarget = 0;
    let monthCollected = 0;
    let monthDues = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    const allStudents: MonthStudentReportRow[] = [];

    students.forEach((student) => {
      const regDate = student.registrationDate || "2026-06-01";
      let regYear = 2026;
      let regMonthIdx = 5;

      if (regDate.includes("/")) {
        const parts = regDate.split("/");
        if (parts.length === 3) {
          regYear = parseInt(parts[2]) || 2026;
          regMonthIdx = (parseInt(parts[1]) || 6) - 1;
        }
      } else {
        const parts = regDate.split("-");
        if (parts.length === 3) {
          regYear = parseInt(parts[0]) || 2026;
          regMonthIdx = (parseInt(parts[1]) || 6) - 1;
        }
      }

      // Check if student was enrolled during this month
      const isBeforeRegistration = year < regYear || (year === regYear && mIdx < regMonthIdx);
      if (!isBeforeRegistration) {
        const studentFee = Number(student?.monthlyFee) || 0;
        const studentName = student?.name || "Student";
        const classGrade = student?.classGrade || "N/A";

        const evaluatedStatus = getEvaluatedFeeStatus(student, monthStr);
        const rawStatus = (student.feeMonths?.[monthStr] || "").toLowerCase();

        let feeStatus: "Paid" | "Unpaid" | "Partial" = "Unpaid";
        let amountPaid = 0;
        let amountDue = studentFee;

        if (rawStatus === "partial") {
          feeStatus = "Partial";
          amountPaid = Math.round(studentFee / 2);
          amountDue = studentFee - amountPaid;
          unpaidCount++;
        } else if (evaluatedStatus === "PAID" || rawStatus === "paid") {
          feeStatus = "Paid";
          amountPaid = studentFee;
          amountDue = 0;
          paidCount++;
        } else if (evaluatedStatus === "UNPAID") {
          feeStatus = "Unpaid";
          amountPaid = 0;
          amountDue = studentFee;
          unpaidCount++;
        } else {
          // Future month / hasn't arrived yet
          feeStatus = "Unpaid";
          amountPaid = 0;
          amountDue = 0; // Do not calculate outstanding dues for months which haven't arrived
        }

        monthTarget += studentFee;
        monthCollected += amountPaid;
        monthDues += amountDue;

        allStudents.push({
          name: studentName,
          classGrade,
          feeStatus,
          amountPaid,
          amountDue,
        });
      }
    });

    // Sort alphabetically by Student Name (A-Z)
    allStudents.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    totalSessionTarget += monthTarget;
    totalSessionRevenue += monthCollected;
    totalSessionDues += monthDues;

    monthlySummaries.push({
      monthStr,
      targetRevenue: monthTarget,
      collectedRevenue: monthCollected,
      duesAmount: monthDues,
      paidCount,
      unpaidCount,
      allStudents,
    });
  });

  // Count active students enrolled during session
  activeStudentCount = students.filter((student) => {
    const regDate = student.registrationDate || "2026-06-01";
    let regYear = 2026;
    if (regDate.includes("-")) {
      regYear = parseInt(regDate.split("-")[0]) || 2026;
    }
    return regYear <= startYear + 1;
  }).length;

  // --- PDF Styling Constants ---
  const primaryColor = [37, 99, 235]; // Blue 600
  const secondaryColor = [30, 41, 59]; // Slate 800
  const lightBg = [248, 250, 252]; // Slate 50
  const redColor = [220, 38, 38]; // Red 600
  const greenColor = [34, 197, 94]; // Green 500

  let currentPage = 1;

  const drawHeaderAndFooter = (pageTitle: string) => {
    // Top Bar
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 6, "F");

    // Top Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(instName.toUpperCase(), 15, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(pageTitle, 15, 23);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-IN")}`, 150, 18);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(15, 26, 195, 26);

    // Footer
    const footerY = 285;
    doc.setDrawColor(226, 232, 240);
    doc.line(15, footerY - 4, 195, footerY - 4);

    doc.setFont("times", "italic");
    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("Developed and Designed by Sumit", 15, footerY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("— POWERED BY ANDROID —", 15, footerY + 3.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Page ${currentPage}`, 180, footerY);
  };

  const checkAddPage = (currentY: number, neededHeight: number = 15, pageTitle: string = "Annual Financial & Audit Report"): number => {
    if (currentY + neededHeight > 270) {
      doc.addPage();
      currentPage++;
      drawHeaderAndFooter(pageTitle);
      return 32;
    }
    return currentY;
  };

  // ================= PAGE 1: SESSION EXECUTIVE SUMMARY =================
  drawHeaderAndFooter(`Annual Financial Audit & Ledger Report (${sessionLabel})`);

  let y = 34;

  // Session Audit Overview Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("1. SESSION FINANCIAL SUMMARY & KPIS", 15, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Audit Session: ${sessionLabel}  |  Active Student Roster: ${activeStudentCount}`, 15, y);

  y += 8;
  // KPI Cards - 2 Cards centered across 180mm width (x=15 to x=195)
  const cardW = 86;
  const cardH = 22;

  // Card 1: Collected
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(15, y, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(15, y, cardW, cardH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("TOTAL REVENUE COLLECTED", 20, y + 6);
  doc.setFontSize(13);
  doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
  doc.text(`INR ${totalSessionRevenue.toLocaleString("en-IN")}`, 20, y + 15);

  // Card 2: Dues
  const card2X = 15 + cardW + 8; // 109
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(card2X, y, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(254, 226, 226);
  doc.roundedRect(card2X, y, cardW, cardH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("TOTAL OUTSTANDING DUES", card2X + 5, y + 6);
  doc.setFontSize(13);
  doc.setTextColor(redColor[0], redColor[1], redColor[2]);
  doc.text(`INR ${totalSessionDues.toLocaleString("en-IN")}`, card2X + 5, y + 15);

  y += cardH + 12;

  // Table: Monthly Overview Breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("2. MONTH-BY-MONTH FINANCIAL OVERVIEW TABLE", 15, y);

  y += 6;
  doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.rect(15, y, 180, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("MONTH", 18, y + 5);
  doc.text("TARGET FEES", 65, y + 5);
  doc.text("COLLECTED", 100, y + 5);
  doc.text("OUTSTANDING DUES", 135, y + 5);
  doc.text("PAID / UNPAID", 170, y + 5);

  y += 7;

  monthlySummaries.forEach((sum, idx) => {
    y = checkAddPage(y, 8, `Session Overview - Page ${currentPage}`);

    if (idx % 2 === 1) {
      doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
      doc.rect(15, y, 180, 7, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(15, y + 7, 195, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(sum.monthStr, 18, y + 5);

    doc.setFont("helvetica", "normal");
    doc.text(`INR ${sum.targetRevenue.toLocaleString("en-IN")}`, 65, y + 5);

    doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
    doc.text(`INR ${sum.collectedRevenue.toLocaleString("en-IN")}`, 100, y + 5);

    doc.setTextColor(sum.duesAmount > 0 ? redColor[0] : 100, sum.duesAmount > 0 ? redColor[1] : 116, sum.duesAmount > 0 ? redColor[2] : 139);
    doc.text(`INR ${sum.duesAmount.toLocaleString("en-IN")}`, 135, y + 5);

    doc.setTextColor(51, 65, 85);
    doc.text(`${sum.paidCount} Paid / ${sum.unpaidCount} Due`, 170, y + 5);

    y += 7;
  });

  // ================= PAGES 2+: STUDENT MONTHLY FEE REPORT BY CLASS & STUDENT =================
  doc.addPage();
  currentPage++;
  drawHeaderAndFooter("Student Monthly Fee Report");
  y = 32;

  // Header Banner
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.roundedRect(15, y, 180, 12, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("STUDENT MONTHLY FEE REPORT — CLASS & STUDENT WISE LEDGER", 20, y + 8);

  y += 18;

  // Group Students by Class
  const classMap: { [className: string]: Student[] } = {};
  students.forEach((s) => {
    const cName = (s.classGrade || "Unassigned").trim();
    if (!classMap[cName]) classMap[cName] = [];
    classMap[cName].push(s);
  });

  // Sort classes logically (extract numeric grade or string)
  const sortedClassNames = Object.keys(classMap).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, "")) || 0;
    const numB = parseInt(b.replace(/\D/g, "")) || 0;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });

  if (sortedClassNames.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text("No student records available for this session.", 18, y);
  } else {
    sortedClassNames.forEach((className) => {
      const classStudents = classMap[className].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
      );

      y = checkAddPage(y, 20, "Student Monthly Fee Report");

      // Class Section Sub-Header
      doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.roundedRect(15, y, 180, 8, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      const cleanClassName = className.toUpperCase().startsWith("CLASS")
        ? className.toUpperCase()
        : `CLASS ${className.toUpperCase()}`;
      doc.text(`${cleanClassName} (${classStudents.length} ${classStudents.length === 1 ? "Student" : "Students"})`, 18, y + 5.5);

      y += 12;

      classStudents.forEach((student) => {
        // Parse registration date
        const regDateStr = student.registrationDate || "2026-06-01";
        let regYear = 2026;
        let regMonthIdx = 5;

        if (regDateStr.includes("/")) {
          const parts = regDateStr.split("/");
          if (parts.length === 3) {
            regYear = parseInt(parts[2]) || 2026;
            regMonthIdx = (parseInt(parts[1]) || 6) - 1;
          }
        } else {
          const parts = regDateStr.split("-");
          if (parts.length === 3) {
            regYear = parseInt(parts[0]) || 2026;
            regMonthIdx = (parseInt(parts[1]) || 6) - 1;
          }
        }

        // Filter session months: only up to present month, plus future months if paid
        const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonthIdx = currentDate.getMonth();

        const admittedMonths = sessionMonths.filter((monthStr) => {
          const [mName, yStr] = monthStr.split(" ");
          const mIdx = monthNames.indexOf(mName);
          const year = parseInt(yStr) || startYear;

          // Check if student was admitted on or before this month
          const isAdmitted = year > regYear || (year === regYear && mIdx >= regMonthIdx);
          if (!isAdmitted) return false;

          // Check if month is present or past relative to current date
          const isPresentOrPast = year < currentYear || (year === currentYear && mIdx <= currentMonthIdx);
          if (isPresentOrPast) return true;

          // Strictly future month: include ONLY if student has ALREADY paid (or partially paid) for it
          const rawStatus = (student.feeMonths?.[monthStr] || "").toLowerCase();
          const evaluatedStatus = getEvaluatedFeeStatus(student, monthStr);
          const isPaid = rawStatus === "paid" || rawStatus === "partial" || evaluatedStatus === "PAID";

          return isPaid;
        });

        y = checkAddPage(y, 28 + (admittedMonths.length * 6), "Student Monthly Fee Report");

        // Student Card Header
        doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
        doc.roundedRect(15, y, 180, 9, 1, 1, "F");
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(15, y, 180, 9, 1, 1, "S");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(30, 41, 59);
        doc.text(`Student: ${student.name || "N/A"}`, 18, y + 6);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Monthly Fee: INR ${Number(student.monthlyFee || 0).toLocaleString("en-IN")}`, 110, y + 6);
        doc.text(`Admitted: ${formatDisplayDate(student.registrationDate)}`, 155, y + 6);

        y += 11;

        // Table Header
        doc.setFillColor(71, 85, 105);
        doc.rect(15, y, 180, 6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text("MONTH", 18, y + 4.2);
        doc.text("STATUS", 62, y + 4.2);
        doc.text("PAID", 92, y + 4.2);
        doc.text("DUE", 122, y + 4.2);
        doc.text("PAYMENT DATE", 148, y + 4.2);
        doc.text("MODE", 178, y + 4.2);

        y += 6;

        let totalPaid = 0;
        let totalDue = 0;

        if (admittedMonths.length === 0) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text("No admitted months recorded for this session.", 18, y + 4);
          y += 6;
        } else {
          admittedMonths.forEach((mStr, mIdx) => {
            y = checkAddPage(y, 6, "Student Monthly Fee Report");

            if (mIdx % 2 === 1) {
              doc.setFillColor(248, 250, 252);
              doc.rect(15, y, 180, 5.5, "F");
            }
            doc.setDrawColor(241, 245, 249);
            doc.line(15, y + 5.5, 195, y + 5.5);

            const studentFee = Number(student.monthlyFee) || 0;
            const evaluatedStatus = getEvaluatedFeeStatus(student, mStr);
            const rawStatus = (student.feeMonths?.[mStr] || "").toLowerCase();
            const payDate = student.feePaymentDates?.[mStr] ? formatDisplayDate(student.feePaymentDates[mStr]) : "N/A";
            const payMode = (student as any).feePaymentModes?.[mStr] || "N/A";

            let feeStatus: "Paid" | "Unpaid" | "Partial" = "Unpaid";
            let amountPaid = 0;
            let amountDue = studentFee;

            if (rawStatus === "partial") {
              feeStatus = "Partial";
              amountPaid = Math.round(studentFee / 2);
              amountDue = studentFee - amountPaid;
            } else if (evaluatedStatus === "PAID" || rawStatus === "paid") {
              feeStatus = "Paid";
              amountPaid = studentFee;
              amountDue = 0;
            } else if (evaluatedStatus === "UNPAID") {
              feeStatus = "Unpaid";
              amountPaid = 0;
              amountDue = studentFee;
            } else {
              feeStatus = "Unpaid";
              amountPaid = 0;
              amountDue = 0;
            }

            totalPaid += amountPaid;
            totalDue += amountDue;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.setTextColor(51, 65, 85);
            doc.text(mStr, 18, y + 3.8);

            if (feeStatus === "Paid") {
              doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
              doc.text("Paid", 62, y + 3.8);
            } else if (feeStatus === "Partial") {
              doc.setTextColor(217, 119, 6);
              doc.text("Partial", 62, y + 3.8);
            } else {
              doc.setTextColor(redColor[0], redColor[1], redColor[2]);
              doc.text("Unpaid", 62, y + 3.8);
            }

            doc.setFont("helvetica", "normal");
            doc.setTextColor(amountPaid > 0 ? greenColor[0] : 100, amountPaid > 0 ? greenColor[1] : 116, amountPaid > 0 ? greenColor[2] : 139);
            doc.text(`INR ${amountPaid.toLocaleString("en-IN")}`, 92, y + 3.8);

            doc.setTextColor(amountDue > 0 ? redColor[0] : 100, amountDue > 0 ? redColor[1] : 116, amountDue > 0 ? redColor[2] : 139);
            doc.text(`INR ${amountDue.toLocaleString("en-IN")}`, 122, y + 3.8);

            doc.setTextColor(100, 116, 139);
            doc.text(payDate, 148, y + 3.8);
            doc.text(payMode, 178, y + 3.8);

            y += 5.5;
          });
        }

        // Student Summary Bar
        doc.setFillColor(241, 245, 249);
        doc.rect(15, y, 180, 5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(30, 41, 59);
        doc.text(`TOTAL COLLECTED: INR ${totalPaid.toLocaleString("en-IN")}  |  TOTAL OUTSTANDING DUES: INR ${totalDue.toLocaleString("en-IN")}`, 18, y + 3.5);

        y += 9;
      });
    });
  }

  // Download PDF file with robust fallback
  const fileName = `Annual_Financial_Audit_${startYear}_${startYear + 1}.pdf`;
  try {
    const pdfBlob = doc.output("blob");
    await saveAndOpenGeneratedPdf(pdfBlob, fileName);
  } catch (error) {
    console.warn("[PDF Generator] Native save failed, using fallback:", error);
    try {
      doc.save(fileName);
    } catch (e) {
      console.error("[PDF Generator] Fallback failed:", e);
      const string = doc.output("datauristring");
      window.open(string, "_blank");
    }
  }
}
