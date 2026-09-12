# MySQL Data Manager - React + Express

This project provides a MySQL data manager with table discovery, browsing,
searching, sorting, and record editing. Express serves the compiled React UI
and the `/api` routes from one container on port 3000. For AWS, Amplify hosts
the React client and API Gateway invokes the Express API as a Lambda function.

## AWS Amplify + Lambda deployment

The repository includes `amplify.yml` for the client and `template.yaml` for
the Lambda function, HTTP API, IAM role, and CloudWatch logs. An existing MySQL
database is required; the template does not create or modify your database.

1. In Amplify Hosting, connect this repository, select the branch, choose the
   monorepo option, and set the application root to `client`. Ensure
   `AMPLIFY_MONOREPO_APP_ROOT=client`. The checked-in build settings use Node 22,
   `npm ci`, and publish `client/dist`. Note the resulting HTTPS frontend origin.
2. In Secrets Manager, create a JSON secret in the deployment region containing
   `DB_USER`, `DB_PASSWORD`, `ADMIN_USER`, `ADMIN_PASSWORD`, and `COOKIE_SECRET`.
   Use a strong random cookie secret. Copy the secret ARN. Application login
   credentials are separate from database credentials.
3. With Node 22, AWS CLI credentials, and AWS SAM CLI installed, run from the
   repository root:

   ```powershell
   sam validate --lint
   sam build
   sam deploy --guided
   ```

   Supply `ClientOrigin` (for example `https://main.APP_ID.amplifyapp.com`, no
   trailing slash), database host/port/name, and `RuntimeSecretArn`. Allow SAM
   to create the IAM role. The API has no API Gateway authorizer because the
   Express routes enforce the application's signed session cookie. The deployment
   identity needs permission to resolve the secret (and decrypt its KMS key if
   applicable). Secret values resolve into Lambda environment variables at
   deployment; after rotation, update the function configuration through a stack
   update to refresh them. Local `.env` files are excluded from the SAM package
   by the server package's explicit file list.
4. For private RDS, supply comma-separated private `SubnetIds` and Lambda
   `SecurityGroupIds` in the database VPC. Allow inbound TCP 3306 (or your DB
   port) on the database security group from the Lambda security group and allow
   corresponding Lambda egress. Leave both parameters empty only when the
   database is reachable without VPC attachment. A public subnet alone does not
   give Lambda a public IP. Consider RDS Proxy for higher concurrency; each warm
   Lambda environment has its own pool (`DatabasePoolSize`, default 2).
5. Copy the stack's `ApiUrl` output to Amplify's `VITE_API_URL` environment
   variable, including `/api`, then redeploy the client. Vite embeds this public
   URL at build time. Put database and login secrets only in the backend, never
   in Amplify's `VITE_*` variables.
6. Open the Amplify URL, sign in, browse a table, and verify record insertion
   and editing against your database. `/api/health` checks database connectivity.

The default `CookieSameSite=none` enables secure cross-site cookies between the
Amplify and API Gateway domains. Browsers that block third-party cookies can
still block this session. For reliable browser support, use custom domains such
as `admin.example.com` (Amplify) and `api.example.com` (API Gateway), set
`ClientOrigin` and `VITE_API_URL` accordingly, and use `CookieSameSite=lax`.
Custom domains and DNS are configured separately from this template. Only the
configured origin is allowed; update `ClientOrigin` when changing the frontend
domain. Arbitrary Amplify preview branches are not automatically authorized.

The current client uses only the root URL, so no SPA rewrite is required.
If client-side routes are added later, configure Amplify's SPA fallback after
any API proxy rules. Composite primary key tables can be browsed and inserted
into, but editing is disabled because the API currently accepts one key column.

AWS references: [Amplify monorepo build settings](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html),
[SAM HTTP APIs](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-httpapi.html).

## Local development

Copy `server/.env.example` to `server/.env` and populate all credentials. Then
run `npm ci` and `npm run dev` in `server/`. In another terminal run `npm ci`
and `npm run dev` in `client/`. Open http://localhost:5173; Vite proxies `/api`
to Express on port 3000. No client environment file is required locally.

Validation: `npm test --prefix server`, `npm run build --prefix client`, and
`sam validate --lint`. Lambda tests use a stub database and exercise API Gateway
v2 requests, origin checks, login, session cookies, logout, and protected routes.

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
serves it. `CORS_ORIGINS` accepts comma-separated browser origins for separate
client hosting; same-origin Docker access works without it.

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

## Container deployment alternative

The image listens on container port `3000`; configure your hosting service
accordingly. Provide DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_USER,
ADMIN_PASSWORD, and COOKIE_SECRET as runtime environment variables or secrets.
For private RDS, the hosting service needs network access to its VPC and the
RDS security group must allow the application's connection on port 3306.

Do not bake credentials into the Docker image. `.env` files are excluded from
both Git and the Docker build context. Use HTTPS and a least-privilege database
account for deployed access.
