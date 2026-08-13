FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Pillow needs the JPEG/zlib runtime; build tools are not required for wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libjpeg62-turbo zlib1g curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Uploaded photos live on a volume — never inside the image layer.
ENV TREFFIT_MEDIA_ROOT=/var/lib/treffit/media
RUN mkdir -p /var/lib/treffit/media && useradd -r -u 10001 treffit \
    && chown -R treffit /var/lib/treffit /app
USER treffit

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# Single worker on purpose: the WebSocket hub is in-process (see app/ws.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
