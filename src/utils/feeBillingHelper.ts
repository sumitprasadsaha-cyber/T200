import { Student } from "../types";
import { MONTH_NAMES, ALL_ACADEMIC_MONTHS, getMonthsUpToCurrent } from "./monthHelper";

/**
 * Checks if a given month string (e.g. "July 2026") is in the past relative to current date.
 */
export function isPastMonth(monthYearStr: string, currentDate: Date = new Date()): boolean {
  const [mName, yStr] = monthYearStr.split(" ");
  const mIdx = MONTH_NAMES.indexOf(mName);
  const year = parseInt(yStr, 10);
  if (mIdx === -1 || isNaN(year)) return false;

  const currentYear = currentDate.getFullYear();
  const currentMonthIdx = currentDate.getMonth();

  if (year < currentYear) return true;
  if (year === currentYear && mIdx < currentMonthIdx) return true;
  return false;
}

/**
 * Checks if a given month string is the current month or in the future relative to current date.
 */
export function isCurrentOrFutureMonth(monthYearStr: string, currentDate: Date = new Date()): boolean {
  return !isPastMonth(monthYearStr, currentDate);
}

/**
 * Rule 2 & 3: Checks if a student has at least one attendance record (Present or Absent) in a month.
 * Attendance count > 0 is sufficient.
 */
export function hasAttendanceInMonth(student: Student, monthYearStr: string): boolean {
  if (!student || !student.attendance) return false;
  const [mName, yStr] = monthYearStr.split(" ");
  const mIdx = MONTH_NAMES.indexOf(mName);
  const year = parseInt(yStr, 10);
  if (mIdx === -1 || isNaN(year)) return false;

  const prefix = `${year}-${String(mIdx + 1).padStart(2, "0")}-`;
  const attendanceKeys = Object.keys(student.attendance);

  // Filter keys for this month with valid non-null attendance entries
  const monthKeys = attendanceKeys.filter(
    (key) => key.startsWith(prefix) && student.attendance[key] !== undefined && student.attendance[key] !== null
  );

  return monthKeys.length > 0;
}

/**
 * Centralized Single Source of Truth for Fee Status Evaluation
 *
 * Fee Status States:
 * - "N/A"    → Not yet billable.
 * - "UNPAID" → Bill generated but not paid.
 * - "PAID"   → Fee paid.
 *
 * Rules:
 * 1. New Month / Current Month / Future Month -> "N/A"
 * 2. Convert "N/A" to "UNPAID" ONLY if:
 *    - Month has ended (isPastMonth === true)
 *    - AND Today >= 3rd day of current month (currentDate.getDate() >= 3)
 *    - AND Student has attendance in that month (hasAttendanceInMonth === true)
 * 3. No Attendance -> "N/A"
 * 4. Preserve existing "PAID" statuses (if already marked "paid" or "PAID", returns "PAID").
 */
export function getEvaluatedFeeStatus(
  student: Student,
  monthYearStr: string,
  currentDate: Date = new Date()
): "PAID" | "UNPAID" | "N/A" {
  if (!student) return "N/A";

  const rawStatus = student.feeMonths?.[monthYearStr];
  const sUpper = rawStatus ? String(rawStatus).toUpperCase() : "";

  if (sUpper === "PAID") return "PAID";

  // Rule 1: Present month or Future month -> "N/A" (never pending for present month)
  if (!isPastMonth(monthYearStr, currentDate)) {
    return "N/A";
  }

  // If month has passed:
  if (sUpper === "NA" || sUpper === "N/A") return "N/A";

  // Rule 2: Provided student has minimum attendance of at least 1 day for that month
  const hasAttendance = hasAttendanceInMonth(student, monthYearStr);
  if (hasAttendance) {
    return "UNPAID";
  }

  return "N/A";
}

/**
 * Evaluates full ledger for a student and returns a record of month -> "PAID" | "UNPAID" | "N/A"
 */
export function getEvaluatedStudentLedger(
  student: Student,
  currentDate: Date = new Date()
): Record<string, "PAID" | "UNPAID" | "N/A"> {
  const months = student?.feeMonthsList && student.feeMonthsList.length > 0
    ? student.feeMonthsList
    : getMonthsUpToCurrent();

  const ledger: Record<string, "PAID" | "UNPAID" | "N/A"> = {};

  // Include all visible months plus any explicitly stored months in student.feeMonths
  const allMonthsSet = new Set([...months, ...Object.keys(student?.feeMonths || {})]);

  allMonthsSet.forEach((m) => {
    ledger[m] = getEvaluatedFeeStatus(student, m, currentDate);
  });

  return ledger;
}

/**
 * Returns array of pending (UNPAID) fee months for a student.
 */
export function getPendingFeeMonths(
  student: Student,
  currentDate: Date = new Date()
): string[] {
  const ledger = getEvaluatedStudentLedger(student, currentDate);
  return Object.keys(ledger).filter((m) => ledger[m] === "UNPAID");
}

/**
 * Calculates total outstanding amount for a student (SUM of all UNPAID months).
 */
export function calculateStudentOutstandingAmount(
  student: Student,
  currentDate: Date = new Date()
): number {
  const unpaidMonths = getPendingFeeMonths(student, currentDate);
  return unpaidMonths.length * (Number(student?.monthlyFee) || 0);
}

/**
 * Returns list of students with pending fees (status == UNPAID)
 */
export function getPendingStudentsList(
  students: Student[],
  currentDate: Date = new Date()
): Array<{
  student: Student;
  pendingMonths: string[];
  pendingAmount: number;
}> {
  return (students || [])
    .map((s) => {
      const pendingMonths = getPendingFeeMonths(s, currentDate);
      const pendingAmount = pendingMonths.length * (Number(s.monthlyFee) || 0);
      return { student: s, pendingMonths, pendingAmount };
    })
    .filter((item) => item.pendingMonths.length > 0);
}

/**
 * Composes WhatsApp billing reminder text for a student.
 */
export function generateWhatsAppBillingMessage(
  student: Student,
  currentDate: Date = new Date()
): string {
  const pendingMonths = getPendingFeeMonths(student, currentDate);
  const totalAmount = calculateStudentOutstandingAmount(student, currentDate);

  if (pendingMonths.length === 0) {
    return `Dear Parent, Student ${student.name} has no pending fee payments. Thank you.`;
  }

  const pluralWord = pendingMonths.length > 1 ? "months" : "month";
  const formattedMonths = pendingMonths.map((m) => m.split(" ")[0]).join(", ");

  return `Dear Parent, Student ${student.name} has Pending Fee payment for the ${pluralWord} of ${formattedMonths}, amounting to ₹ ${totalAmount}. Kindly, make the payment. Thank you`;
}
