set dotenv-load

db:
    podman run -d \
      --name postgres \
      -e POSTGRES_USER \
      -e POSTGRES_PASSWORD \
      -e POSTGRES_DB \
      -p 5432:5432 \
      docker.io/library/postgres:15

web:
    uv run --env-file .env web/server.py


