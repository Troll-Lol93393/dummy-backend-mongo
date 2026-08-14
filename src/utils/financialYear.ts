/**
 * Indian financial year runs April 1 - March 31.
 * A date in Jan-Mar belongs to the FY that started the previous calendar year.
 */
export function getFinancialYearStartYear(date: Date): number {
    const month = date.getMonth(); // 0-indexed, 0 = Jan, 3 = Apr
    const year = date.getFullYear();
    return month >= 3 ? year : year - 1;
}

/** e.g. 2025 -> "2025-26" */
export function getFinancialYearLabel(date: Date): string {
    const startYear = getFinancialYearStartYear(date);
    const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
    return `${startYear}-${endYearShort}`;
}

/** Parse a "2025-26" label back into its start/end date range (inclusive). */
export function getFinancialYearRange(label: string): { start: Date; end: Date } | undefined {
    const match = label.match(/^(\d{4})-(\d{2})$/);
    if (!match) return undefined;
    const startYear = Number(match[1]);
    const start = new Date(startYear, 3, 1, 0, 0, 0, 0);
    const end = new Date(startYear + 1, 2, 31, 23, 59, 59, 999);
    return { start, end };
}
