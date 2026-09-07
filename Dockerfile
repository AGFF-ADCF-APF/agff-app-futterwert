# Schlankes Python Image als Basis
FROM python:3.11-slim

# Arbeitsverzeichnis setzen
WORKDIR /app

# Abhängigkeiten installieren
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Den Rest des Codes kopieren
COPY . .

# Sicherstellen, dass der Data-Ordner existiert (für SQLite)
RUN mkdir -p data

# Port freigeben
EXPOSE 5000

# Server starten (Gunicorn für Produktion)
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
