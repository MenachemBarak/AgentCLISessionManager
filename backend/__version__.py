"""Single source of truth for the package version.

Referenced by:
- backend/app.py (exposed at /api/status)
- pyproject.toml [project].version (loaded dynamically via setuptools-scm or
  read at build time)
- the release workflow (validated against the git tag that triggered it)

Bump this in a commit on `main`, then tag the commit `vX.Y.Z` — the tag
must match `__version__`.
"""

__version__ = "0.7.1"
