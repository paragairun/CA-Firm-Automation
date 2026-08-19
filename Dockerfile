# Cloud Run container. Listens on $PORT (Cloud Run sets this to 8080).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

# workers=1, threads=8: no in-process scheduler/poller to worry about
# duplicating anymore (see app.py), so this is just about request
# concurrency — plenty for a small CA firm's traffic. timeout=0 disables
# gunicorn's own worker timeout since Cloud Run already enforces its own
# request timeout (configurable at deploy time, default 300s).
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app
