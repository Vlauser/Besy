FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    U2NET_HOME=/opt/models

# libgomp1 нужен onnxruntime, libglib2.0-0 — opencv.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

# Модель сегментации (~180 МБ) кладём в образ, чтобы контейнер не тянул её
# при первом запросе и работал в сети без исходящего доступа.
RUN mkdir -p $U2NET_HOME \
    && python -c "from rembg import new_session; new_session('isnet-general-use')"

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
