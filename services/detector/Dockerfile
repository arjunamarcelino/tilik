# syntax=docker/dockerfile:1
# Tilik detector worker (Python 3.11, scikit-learn TF-IDF). Build context is the REPO ROOT.
#   docker build -f services/detector/Dockerfile -t tilik-detector .
#
# slim-bookworm (glibc 2.36) satisfies manylinux_2_28, so numpy/scipy/scikit-learn install as prebuilt
# wheels — no compiler. (Alpine/musl would force a from-source SciPy build.) psycopg[binary] bundles libpq,
# so no system libpq-dev. The venv is copied builder→runtime, so BOTH stages use the identical interpreter.

FROM python:3.11-slim-bookworm AS build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /src
# pyproject + the package source (hatchling builds the `detector` wheel from packages=["detector"]).
COPY services/detector/pyproject.toml ./
COPY services/detector/detector ./detector
# Cache mount (not --no-cache-dir): a code edit invalidates this layer, but pip reuses the cached
# numpy/scipy/scikit-learn wheels from the mount instead of re-downloading ~150 MB each build.
RUN --mount=type=cache,target=/root/.cache/pip pip install .

FROM python:3.11-slim-bookworm AS runtime
# TZ=UTC is load-bearing: the repeat-billing detector keys on "same UTC day"; a non-UTC container would
# shift day boundaries. Unbuffered stdout so `docker logs` streams the JSON log lines live.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=UTC PATH=/opt/venv/bin:$PATH
# Non-root. The `detector` package is installed INTO the venv, so no source copy is needed at runtime.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /opt/venv /opt/venv
USER app
# Worker installs its own SIGTERM/SIGINT handlers (interruptible poll) → clean shutdown as PID 1; compose
# `init: true` adds defensive reaping/forwarding.
CMD ["python", "-m", "detector.worker"]
