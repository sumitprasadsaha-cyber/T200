export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", 
  "July", "August", "September", "October", "November", "December"
];

export const ALL_ACADEMIC_MONTHS = (() => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed

  let currentFYStartYear = currentYear;
  if (currentMonth < 4) {
    currentFYStartYear = currentYear - 1;
  }
  // March of next financial year will end in currentFYStartYear + 2
  const maxYear = currentFYStartYear + 2;

  const list: string[] = [];
  // Historical academic records starting from March 2026
  const curr = new Date(2026, 2, 1);
  const end = new Date(maxYear, 2, 1);

  while (curr <= end) {
    list.push(`${MONTH_NAMES[curr.getMonth()]} ${curr.getFullYear()}`);
    curr.setMonth(curr.getMonth() + 1);
  }
  return list;
})();

export function getMonthsUpToCurrent(): string[] {
  const now = new Date();
  const currentMonthIdx = now.getMonth(); // 0-11
  const currentYear = now.getFullYear();
  const currentMonthName = MONTH_NAMES[currentMonthIdx];
  const currentMonthYearStr = `${currentMonthName} ${currentYear}`;

  const idx = ALL_ACADEMIC_MONTHS.indexOf(currentMonthYearStr);
  if (idx === -1) {
    const backupIdx = ALL_ACADEMIC_MONTHS.indexOf("July 2026");
    if (backupIdx === -1) {
      return ALL_ACADEMIC_MONTHS;
    }
    return ALL_ACADEMIC_MONTHS.slice(0, backupIdx + 1);
  }
  return ALL_ACADEMIC_MONTHS.slice(0, idx + 1);
}
