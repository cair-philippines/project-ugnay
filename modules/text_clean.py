"""
Text repair for institution and place names.

WHY THIS EXISTS
---------------
Some upstream names arrive **mojibaked** — UTF-8 bytes that were decoded once as
Latin-1/CP1252 and then re-encoded as UTF-8, so `ñ` (U+00F1) becomes `Ã±` and `Ñ`
becomes `Ã‘`. In a country whose place names are full of `ñ` — Parañaque, Los Baños,
Santo Niño, Peñablanca — this is not a rare edge case, and a planner who sees
"MontaÃ±eza NHS" reasonably concludes the whole dataset is untrustworthy.

The corruption originates in the `project_coordinates` gold parquets (as of 2026-07-12:
3 `school_name` + 222 `barangay` in public schools, 41 `barangay` in private). It should
be fixed there too — but Ugnay normalises defensively at ingest regardless, because a
rendering pipeline should never be one bad upstream field away from showing garbage.

WHY THE ROUND-TRIP IS SAFE
--------------------------
`s.encode("latin-1").decode("utf-8")` reverses the exact corruption above. It is applied
only when it demonstrably *improves* the string:

  * the string must contain a mojibake marker to begin with,
  * the round-trip must succeed (most clean text raises UnicodeEncodeError — anything
    with a real non-Latin-1 char, e.g. "–", cannot even be encoded, so it is untouched),
  * the result must contain no U+FFFD, and
  * the result must have strictly fewer markers than the input.

So a legitimately-accented name that merely happens to contain "Ã" (e.g. Portuguese
"São") is left alone unless the decode genuinely produces cleaner text.
"""

# The tell-tales of Latin-1/CP1252-decoded UTF-8. `Ã` and `Â` cover the accented-Latin
# range; `â€` covers the smart quotes and dashes (’ “ ” –).
_MARKERS = ("Ã", "Â", "â€", "�")

_MAX_PASSES = 3  # doubly-mojibaked strings exist; three unwinds is more than enough


def _markers(s: str) -> int:
    return sum(s.count(m) for m in _MARKERS)


def fix_mojibake(value):
    """Repair a doubly-encoded string. Non-strings and clean strings pass through."""
    if not isinstance(value, str) or not _markers(value):
        return value

    out = value
    for _ in range(_MAX_PASSES):
        before = out
        for codec in ("latin-1", "cp1252"):
            try:
                candidate = out.encode(codec).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            # Only accept a strict improvement — never trade one corruption for another.
            if "�" not in candidate and _markers(candidate) < _markers(out):
                out = candidate
                break
        if out == before:  # nothing improved this pass; we're done
            break
        if not _markers(out):
            break
    return out


def fix_mojibake_df(df, columns=None):
    """Apply `fix_mojibake` to every text column of a DataFrame (or the named ones).

    Returns (df, n_repaired). The count is how many *cells* changed — worth logging, so a
    silent upstream regression shows up in the pipeline output instead of on the map.
    """
    cols = columns if columns is not None else [c for c in df.columns if df[c].dtype == object]
    repaired = 0
    for col in cols:
        if col not in df.columns:
            continue
        original = df[col]
        fixed = original.map(fix_mojibake)
        changed = (original != fixed) & original.notna()
        repaired += int(changed.sum())
        df[col] = fixed
    return df, repaired


def find_mojibake(value) -> bool:
    """True if the string still carries mojibake markers — for build-time assertions."""
    return isinstance(value, str) and _markers(value) > 0
