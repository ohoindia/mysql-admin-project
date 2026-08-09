# MySQL Data Manager - React + FastAPI in one Docker container

This project provides a generic MySQL data manager with:

- Dynamic table discovery
- Dynamic schema/column discovery
- Data browsing with pagination
- Global search
- Column sorting
- Insert
- Edit/update using the table primary key
- One production Docker image containing both the React frontend and FastAPI backend

## Architecture

Browser -> one container (React static UI + FastAPI `/api`) -> MySQL

The React build is copied into the Python image and FastAPI serves the compiled files. This means AWS only needs to run one container and one public URL.

## Local Docker run

Copy `.env.docker.example` to `.env` and update the database values.

```bash
cp .env.docker.example .env
```

Build:

```bash
docker build -t mysql-admin-app .
```

Run:

```bash
docker run --rm -p 8080:8080 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=root \
  -e DB_PASSWORD=your_password \
  -e DB_NAME=your_database \
  -e CORS_ORIGINS=http://localhost:8080 \
  mysql-admin-app
```

On Windows Command Prompt, put the command on one line or use `docker compose up --build` after creating `.env`.

Open:

- Application: http://localhost:8080
- API health: http://localhost:8080/api/health
- Swagger: http://localhost:8080/docs

## Docker Compose

```bash
docker compose up --build
```

## AWS deployment

Recommended simple path: Amazon ECR + AWS App Runner.

1. Build the image locally.
2. Create an ECR repository.
3. Authenticate Docker to ECR.
4. Tag and push the image.
5. Create an App Runner service from the ECR image.
6. Configure container port `8080`.
7. Add DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME as App Runner environment variables/secrets.
8. If MySQL/RDS is private, configure an App Runner VPC Connector and allow port 3306 from the connector security group to the RDS security group.

Do not bake DB credentials into the Docker image.

## Production security

This app can edit database data. Before exposing it to users, add authentication/authorization, audit logging, HTTPS (AWS provides this on App Runner), and use a least-privilege MySQL account rather than root.
"# mysql-admin-project" 
