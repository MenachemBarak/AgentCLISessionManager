"""Smart session search (task #40).

Local, offline ranking over the session index. No API key required, no
external calls. Scores each session against a natural-language query by
TF-weighted overlap across title, user-set label, Claude-set title,
first user messages, and cwd.

Ranking: a simplified BM25-lite — per-field TF with length normalization,
plus a small boost for exact phrase matches and multi-term co-occurrence
in the same field. Good enough for "find the session where I debugged
the ws paste bug" over ~10k sessions without any ML heavy-lifting.

A follow-up PR can add an optional Claude-SDK re-rank of the top-20
results when ANTHROPIC_API_KEY is set, for semantic queries that keyword
overlap alone can't handle. The API surface here is designed to support
that without breaking changes — callers already pass a `limit`.
"""

from __future__ import annotations

import re
from typing import Any

# Short English stopword list. Kept deliberately small: too aggressive
# stopwording on short queries like "fix the bug" strips half the query
# and ranking falls over. These are words users almost certainly don't
# mean to match on literally.
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "the",
        "to",
        "was",
        "were",
        "with",
    }
)

# Very light stemming: strip a trailing "s" or "es"/"ed"/"ing" from tokens
# ≥5 chars so plural/tense variants land in the same bucket. Not a real
# stemmer (would need a dep); good enough to match "debugging" ≈ "debug".
_STEM_SUFFIXES = ("ing", "ed", "es", "s")


def _tokenize(text: str) -> list[str]:
    """Lowercase + split on non-word runs + drop stopwords + stem.

    Uses `\\w+` (unicode-aware in Python 3) so Hebrew, Chinese, accented
    Latin, etc., all tokenize correctly. The earlier `[A-Za-z0-9_]+`
    regex silently dropped every non-ASCII character — users with
    non-English sessions got empty search results.
    """
    tokens: list[str] = []
    for raw in re.findall(r"\w+", (text or "").lower(), flags=re.UNICODE):
        if raw in _STOPWORDS:
            continue
        # Stem only ASCII-alphabetic tokens; don't attempt to stem
        # non-ASCII words (e.g. Hebrew/Chinese have their own
        # morphology that "-ing"/"-ed" stripping doesn't apply to).
        if len(raw) >= 5 and raw.isascii():
            for suf in _STEM_SUFFIXES:
                if raw.endswith(suf) and len(raw) - len(suf) >= 3:
                    raw = raw[: -len(suf)]
                    break
        if raw:
            tokens.append(raw)
    return tokens


# Field weights — how much each source of text contributes. Tuned so
# title + user-label dominate (user-curated), then Claude title, then
# message bodies (noisiest), then cwd (mostly directory path chaff).
_WEIGHTS = {
    "userLabel": 5.0,
    "title": 3.0,
    "claudeTitle": 2.5,
    "firstUserMessages": 1.0,
    "cwd": 0.4,
}


def _score_session(
    query_tokens: list[str],
    session: dict[str, Any],
    phrase: str,
) -> float:
    if not query_tokens:
        return 0.0
    score = 0.0
    q_set = set(query_tokens)

    # Per-field TF with length normalisation (longer text ≠ automatically
    # better match — otherwise a 10k-line transcript dominates).
    for field, weight in _WEIGHTS.items():
        raw = session.get(field)
        if raw is None:
            continue
        # firstUserMessages is a list of strings; the rest are strings.
        if isinstance(raw, list):
            field_text = "\n".join(str(x) for x in raw)
        else:
            field_text = str(raw)
        if not field_text:
            continue
        tokens = _tokenize(field_text)
        if not tokens:
            continue
        # Term frequency per query token (count of occurrences) divided
        # by the square root of the field length — a standard length-
        # normalisation knob.
        length_norm = max(1.0, len(tokens) ** 0.5)
        hits = 0
        for t in query_tokens:
            tf = tokens.count(t)
            if tf > 0:
                hits += 1
                score += weight * (tf / length_norm)
        # Co-occurrence boost: all query tokens appearing in this field
        # together is a much stronger signal than scattered hits.
        if hits == len(q_set) and len(q_set) >= 2:
            score += weight * 0.5

    # Exact-phrase boost across the whole session blob — cheap to check.
    if phrase and len(phrase) >= 4:
        blob_parts: list[str] = []
        for field in _WEIGHTS:
            raw = session.get(field)
            if isinstance(raw, list):
                blob_parts.extend(str(x) for x in raw)
            elif raw:
                blob_parts.append(str(raw))
        blob = " ".join(blob_parts).lower()
        if phrase in blob:
            score += 3.0

    return score


def rank_sessions(query: str, sessions: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    """Return sessions ranked by relevance to `query` (highest first).

    Each returned entry is the original session dict plus a `_score`
    field. Zero-score sessions are dropped. Stable for score ties
    (falls back to the input order — callers should hand us a list
    pre-sorted by lastActive so recent wins ties).
    """
    query = (query or "").strip()
    if not query or not sessions:
        return []
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []
    phrase = query.lower().strip()

    scored: list[tuple[float, int, dict[str, Any]]] = []
    for i, s in enumerate(sessions):
        sc = _score_session(q_tokens, s, phrase)
        if sc > 0:
            scored.append((sc, i, s))
    # Sort by score desc, then input-index asc (stable for ties).
    scored.sort(key=lambda t: (-t[0], t[1]))
    out: list[dict[str, Any]] = []
    for sc, _idx, s in scored[:limit]:
        merged = dict(s)
        merged["_score"] = round(sc, 4)
        out.append(merged)
    return out
