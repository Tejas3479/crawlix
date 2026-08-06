FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install OS dependencies for playwright
RUN apt-get update && playwright install-deps && rm -rf /var/lib/apt/lists/*

# Copy the rest of the application
COPY . .

EXPOSE 8000

# Run Alembic migrations and then start Uvicorn server
CMD ["sh", "-c", "python -m alembic upgrade head && uvicorn app:app --host 0.0.0.0 --port 8000"]
