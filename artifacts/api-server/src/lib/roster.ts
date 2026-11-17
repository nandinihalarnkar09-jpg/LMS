/**
 * Bulk roster import — parsing and validation (pure, no database).
 *
 * Spec: docs/specs/roster-import.md. Summary:
 *   - Header row required; column order free; names case-insensitive.
 *   - Columns: email (required), name, roll_no, role (student|teacher,
 *     default student), cohort (one or more cohort names separated by ";").
 *   - Each row is judged on its own. Problems never block the other rows: the
 *     admin previews first, fixes or drops the flagged rows, then imports.
 */

export const MAX_ROWS = 5000;

export type RosterRow = {
  line: number; // 1-based line number in the file, as a spreadsheet shows it
  email: string;
  name: string | null;
  rollNo: string | null;
  role: "student" | "teacher";
  cohortNames: string[];
};

export type RowProblem = { line: number; email: string | null; message: string };

const COLUMN_ALIASES: Record<string, keyof typeof CANONICAL> = {
  email: "email",
  e_mail: "email",
  email_address: "email",
  name: "name",
  full_name: "name",
  student_name: "name",
  roll_no: "roll_no",
  roll_number: "roll_no",
  rollno: "roll_no",
  roll: "roll_no",
  prn: "roll_no",
  role: "role",
  cohort: "cohort",
  cohorts: "cohort",
  section: "cohort",
  batch: "cohort",
};
const CANONICAL = { email: 1, name: 1, roll_no: 1, role: 1, cohort: 1 };

const EMAIL_RE = /^[^@\s,;"<>]+@[^@\s,;"<>]+\.[^@\s,;"<>]{2,}$/;

/**
 * RFC 4180 CSV → rows of cells. Handles quoted fields, escaped quotes (""),
 * commas/newlines inside quotes, CRLF, and a UTF-8 BOM (Excel adds one).
 * Returns each row with the 1-based line it started on.
 */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  let fieldWasQuoted = false;

  const endField = () => {
    cells.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (!(cells.length === 1 && cells[0] === "")) rows.push({ cells, line: rowStart });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      inQuotes = true;
      fieldWasQuoted = true;
      field = "";
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowStart = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    // Unterminated quote: keep what we have so the row is reported, not lost.
    fieldWasQuoted = false;
  }
  if (field !== "" || cells.length > 0) endRow();
  return rows;
}

export type ParsedRoster = {
  rows: RosterRow[];
  problems: RowProblem[];
  fatal: string | null; // a whole-file problem (no header, no email column, too many rows)
};

/** Parse and validate a roster CSV. Duplicate detection within the file is included. */
export function parseRoster(text: string): ParsedRoster {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], problems: [], fatal: "The file is empty." };

  const header = parsed[0].cells.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const index: Partial<Record<keyof typeof CANONICAL, number>> = {};
  header.forEach((h, i) => {
    const key = COLUMN_ALIASES[h];
    if (key && index[key] === undefined) index[key] = i;
  });
  if (index.email === undefined) {
    return {
      rows: [],
      problems: [],
      fatal: `No "email" column found. The first row must be a header such as: email,name,roll_no,role,cohort (found: ${parsed[0].cells.join(", ") || "nothing"}).`,
    };
  }
  const dataRows = parsed.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return {
      rows: [],
      problems: [],
      fatal: `The file has ${dataRows.length.toLocaleString("en-IN")} rows; the limit is ${MAX_ROWS.toLocaleString("en-IN")} per import. Split it into smaller files.`,
    };
  }

  const rows: RosterRow[] = [];
  const problems: RowProblem[] = [];
  const firstLineForEmail = new Map<string, number>();
  const firstLineForRoll = new Map<string, number>();
  const cell = (cells: string[], key: keyof typeof CANONICAL) =>
    index[key] === undefined ? "" : (cells[index[key]!] ?? "").trim();

  for (const { cells, line } of dataRows) {
    if (cells.every((c) => c.trim() === "")) continue; // blank line
    const email = cell(cells, "email").toLowerCase();
    if (cells.length > header.length) {
      problems.push({ line, email: email || null, message: `This row has ${cells.length} columns but the header has ${header.length}. Check for an unquoted comma (e.g. in a name) and wrap that value in double quotes.` });
      continue;
    }
    if (!email) {
      problems.push({ line, email: null, message: "Email is missing." });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      problems.push({ line, email, message: `"${email}" doesn't look like an email address.` });
      continue;
    }
    const roleRaw = cell(cells, "role").toLowerCase();
    const role =
      roleRaw === "" || roleRaw === "student" ? "student" : roleRaw === "teacher" || roleRaw === "faculty" ? "teacher" : null;
    if (!role) {
      problems.push({ line, email, message: `Role "${cell(cells, "role")}" isn't recognised. Use "student" or "teacher" (or leave it blank for student).` });
      continue;
    }
    const dupLine = firstLineForEmail.get(email);
    if (dupLine !== undefined) {
      problems.push({ line, email, message: `Same email as row ${dupLine}. Only the first row is imported.` });
      continue;
    }
    const rollNo = cell(cells, "roll_no") || null;
    if (rollNo) {
      const rollLine = firstLineForRoll.get(rollNo.toLowerCase());
      if (rollLine !== undefined) {
        problems.push({ line, email, message: `Roll number ${rollNo} is also used on row ${rollLine}. Roll numbers must be unique.` });
        continue;
      }
      firstLineForRoll.set(rollNo.toLowerCase(), line);
    }
    firstLineForEmail.set(email, line);
    const name = cell(cells, "name") || null;
    const cohortNames = cell(cells, "cohort")
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean);
    rows.push({ line, email, name: name ? name.slice(0, 120) : null, rollNo: rollNo ? rollNo.slice(0, 40) : null, role, cohortNames });
  }
  return { rows, problems, fatal: null };
}

/** Quote a value for a CSV cell. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  // Prefix formula-looking values so Excel/Sheets never execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
