# MySQL Data Manager - React + Express in one Docker container

This project provides a MySQL data manager with table discovery, browsing,
searching, sorting, and record editing. Express serves the compiled React UI
and the `/api` routes from one container on port 3000.

## Local Docker run

In PowerShell, create your runtime environment file:

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env` with your database connection values. For RDS, set `DB_HOST` to
your RDS endpoint. Set `ADMIN_USER` and `ADMIN_PASSWORD` for the application
login, and replace `COOKIE_SECRET` with a long random secret. These login
credentials are separate from the database credentials.

Build and run:

```powershell
docker build -t mysql-admin-app .
docker run --rm -p 8080:3000 --env-file .env mysql-admin-app
```

Open:

- Application: http://localhost:8080
- Database health: http://localhost:8080/api/health

The port mapping exposes host port 8080 and forwards it to container port 3000.
The Dockerfile copies the React build to `/app/server/public`, where Express
serves it. The current server does not use `CORS_ORIGINS` or provide Swagger UI.

## Docker Compose

After creating and editing `.env`, run:

```powershell
docker compose up --build
```

Compose uses the same `.env` file and exposes http://localhost:8080.

## Troubleshooting

- Missing environment variables: populate all values in `.env.docker.example`.
- Database connection failure: check credentials and network access to the
  database host on port 3306, including RDS security group rules.
- Login cookies: production uses secure cookies. Use HTTPS for deployed access.
  For local HTTP testing only, you can add `-e NODE_ENV=development` to the
  `docker run` command if your browser does not retain the session cookie.

## AWS deployment

The image listens on container port `3000`; configure your hosting service
accordingly. Provide DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_USER,
ADMIN_PASSWORD, and COOKIE_SECRET as runtime environment variables or secrets.
For private RDS, the hosting service needs network access to its VPC and the
RDS security group must allow the application's connection on port 3306.

Do not bake credentials into the Docker image. `.env` files are excluded from
both Git and the Docker build context. Use HTTPS and a least-privilege database
account for deployed access.
