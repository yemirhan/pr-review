/**
 * Extract a ClickUp task ID from a branch name.
 *
 * Supports two ID flavors that ClickUp recognizes as "custom task IDs":
 *   - Letter-prefixed form like `REC-101`, `ABC-1234` (preferred when present).
 *   - Pure numeric form like `1234`.
 *
 * Examples:
 *   feature/foo-REC-101-fix-login   -> 'REC-101'
 *   feature/REC-101                 -> 'REC-101'
 *   bugfix/myproj-1234-thing        -> '1234'
 *   users/yemi/REC-101-something    -> 'REC-101'
 *   main                            -> null
 */
export function parseTaskIdFromBranch(branch: string): string | null {
  if (!branch) return null;
  const tail = branch.includes('/') ? branch.slice(branch.lastIndexOf('/') + 1) : branch;

  // 1) Prefer a letter-prefix custom ID anywhere in the branch tail.
  //    Bounded by start / `-` / `_` on the left, and `-` / `_` / end on the right.
  const custom = /(?:^|[-_])([A-Za-z][A-Za-z0-9]*-\d+)(?=$|[-_])/.exec(tail);
  if (custom) return custom[1].toUpperCase();

  // 2) Fall back to <word>-<digits> for pure numeric IDs.
  const numeric = /^[A-Za-z][\w-]*?-(\d+)(?:[-_].*)?$/.exec(tail);
  return numeric ? numeric[1] : null;
}
