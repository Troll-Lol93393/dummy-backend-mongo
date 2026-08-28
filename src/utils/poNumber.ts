const CORE_PO_NUMBER_PATTERN = /\b4\d{9}\b/;

/**
 * PO Register entries are frequently stored with a job-number prefix (e.g.
 * "VJNR/110500/REV/R/4100189516", "PCMD-ANJARWORK/2526/4100551221"), while
 * Sales rows and customer emails reference the bare 10-digit PO number.
 * Exact-string matching between the two silently fails — this extracts the
 * core number so both sides compare consistently. Falls back to the
 * trimmed original when no 10-digit token is found, so the result is never
 * empty/undefined.
 */
export function extractCorePoNumber(raw: string): string {
    const trimmed = (raw || "").trim();
    const match = trimmed.match(CORE_PO_NUMBER_PATTERN);
    return match ? match[0] : trimmed;
}
