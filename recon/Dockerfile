# Slim Python base — much smaller than the default python image,
# enough for our stdlib-only recon job.
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (separate layer for cache reuse).
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# Then copy the source.
COPY src ./src

# Non-root user — defense in depth.
RUN useradd -r -u 1000 -s /sbin/nologin recon \
    && chown -R recon:recon /app
USER recon

# The CLI entry point from pyproject.toml.
# Args (--internal, --gateway, --output) are provided by the
# EventBridge target's container overrides at task invocation time.
ENTRYPOINT ["recon"]