# MySQL Data Manager - React + Express

This project provides a MySQL data manager with table discovery, browsing,
searching, sorting, and record editing. Express serves the compiled React UI
and the `/api` routes from one container on port 3000. For AWS, Amplify hosts
the React client and API Gateway invokes the Express API as a Lambda function.

## AWS Amplify + Lambda deployment

Amplify hosts the client and automatically deploys changes pushed or merged to
`main`. The server is deployed separately using `template.yaml`, which creates
Lambda, API Gateway HTTP API, an IAM role, and CloudWatch logs. An existing MySQL
database is required. Runtime variables are entered directly in the Lambda
console; Secrets Manager is not required, and the template does not manage the
function's environment variables.

1. **Check local tools and AWS access.** Use Node 22, AWS CLI, and AWS SAM CLI.
   From the repository root in PowerShell, run:

   ```powershell
   node --version
   aws --version
   sam --version
   aws sts get-caller-identity
   ```

   If the identity check fails, sign in with your organization's AWS profile
   or configure AWS CLI credentials before continuing. Use the same region as
   your database. For a named profile, add `--profile YOUR_PROFILE` to AWS and
   SAM deployment commands.

2. **Prepare database networking.** For private RDS, choose private subnet IDs
   and a Lambda security group in the database VPC. On the RDS security group,
   allow inbound TCP 3306 (or your database port) from the Lambda security group.
   Allow the corresponding outbound traffic from Lambda. A public subnet alone
   does not give Lambda a public IP. Leave both VPC parameters empty only if the
   database is reachable without VPC attachment.

3. **Create the Lambda deployment.** Run:

   ```powershell
   sam validate --lint
   sam build
   sam deploy --guided
   ```

   Answer the guided prompts:

   | Prompt | Value |
   |---|---|
   | Stack Name | `mysql-admin-api` |
   | AWS Region | Your database region, for example `ap-south-1` |
   | SubnetIds | Comma-separated private subnet IDs, or empty as described above |
   | SecurityGroupIds | Comma-separated Lambda security group IDs; required with subnets |
   | Confirm changes before deploy | `Y` |
   | Allow SAM CLI IAM role creation | `Y` |
   | ApiFunction has no authentication, is this okay? | `Y`; Express enforces login and bearer tokens |
   | Disable rollback | `N` |
   | Save arguments to configuration file | `Y`; keep the default file/environment |

   Save the stack outputs `FunctionName` and `ApiUrl`. The function will reject
   requests until the required environment variables are configured in step 4.
   Local `.env` files are excluded from the package by `server/package.json`'s
   explicit file list. Do not upload the source folder with its local `.env`.

4. **Set Lambda environment variables.** In AWS Console, select the deployment
   region, open **Lambda > Functions > the FunctionName output > Configuration
   > Environment variables > Edit**, and add these values:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DB_HOST` | MySQL/RDS hostname without `https://` |
   | `DB_PORT` | `3306`, or your database port |
   | `DB_USER` | Database username |
   | `DB_PASSWORD` | Database password |
   | `DB_NAME` | Database name |
   | `ADMIN_USER` | Application login username |
   | `SUPER_USER` | Optional additional login username with access to all tables, bypassing `ALLOWED_TABLES` |
   | `ADMIN_PASSWORD` | Application login password shared by `ADMIN_USER` and `SUPER_USER` |
   | `SESSION_SECRET` | Long random signing secret; generate it using the command below |
   | `CORS_ORIGINS` | Exact Amplify HTTPS origin, e.g. `https://main.APP_ID.amplifyapp.com`, without a trailing slash |
   | `DB_POOL_SIZE` | `2` |
   | `ALLOWED_TABLES` | Optional comma-separated table names for `ADMIN_USER`; omit to allow all tables. Does not restrict `SUPER_USER` |

   Generate a signing secret locally:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Click **Save** and wait for the function update to finish. Application login
   credentials are separate from database credentials. Lambda supplies AWS
   runtime variables itself; do not add `AWS_REGION` or
   `AWS_LAMBDA_FUNCTION_NAME`. No `PORT` setting is needed for Lambda.

5. **Connect the already deployed Amplify client.** In Amplify's environment
   variables, set `VITE_API_URL` to the stack's `ApiUrl`, including `/api`:

   ```text
   VITE_API_URL=https://API_ID.execute-api.ap-south-1.amazonaws.com/api
   ```

   Keep `AMPLIFY_MONOREPO_APP_ROOT=client`. Amplify builds using `amplify.yml`
   and publishes `client/dist`. A push or merge to `main` triggers the next
   build automatically. If you only change `VITE_API_URL` in the console,
   manually redeploy the branch once because Vite embeds the URL at build time.
   Do not put database credentials or login secrets in `VITE_*` variables.

6. **Verify the deployment.** Open `ApiUrl` followed by `/health`:

   ```text
   https://API_ID.execute-api.ap-south-1.amazonaws.com/api/health
   ```

   Expected response:

   ```json
   {"status":"OK","database":"connected"}
   ```

   Open the Amplify app, sign in with `ADMIN_USER` and `ADMIN_PASSWORD`, and
   verify table browsing, insertion, and editing. If the API fails, check
   **Lambda > Monitor > View CloudWatch logs**, environment variables, and
   database networking.

Login returns a signed bearer token valid for 12 hours. The client stores it in
`sessionStorage` (per tab, survives reloads) and sends `Authorization: Bearer ...`
on API requests. No cookies or custom domains are required, including on mobile.
Closing the tab ends the stored session. A 401 clears the token and requires login.
Logout removes the browser token; a copied token remains valid until expiry or
signing-secret rotation. Keep tokens out of logs and URLs. Session storage is
accessible to JavaScript on the client origin, so prevent script injection.
CORS allows the Authorization header only for configured browser origins.

The client currently uses only the root URL, so no SPA rewrite is required.
Composite primary key tables can be browsed and inserted into, but editing is
disabled because the API accepts one key column. Each warm Lambda environment
has its own database pool; consider RDS Proxy for higher concurrency.

AWS references: [Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html),
[SAM deployment](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html).

## Local development

Copy `server/.env.example` to `server/.env` and populate all credentials. Then
run `npm ci` and `npm run dev` in `server/`. In another terminal run `npm ci`
and `npm run dev` in `client/`. Open http://localhost:5173; Vite proxies `/api`
to Express on port 3000. No client environment file is required locally.

Validation: `npm test --prefix server`, `npm run build --prefix client`, and
`sam validate --lint`. Lambda tests use a stub database and exercise API Gateway
v2 requests, origin checks, login, bearer tokens, logout, and protected routes.

## Local Docker run

In PowerShell, create your runtime environment file:

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env` with your database connection values. For RDS, set `DB_HOST` to
your RDS endpoint. Set `ADMIN_USER` and `ADMIN_PASSWORD` for the application
login, and replace `SESSION_SECRET` with a long random secret. These login
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
- Unauthorized requests: sign in again and verify an Authorization header is sent.

## Container deployment alternative

The image listens on container port `3000`; configure your hosting service
accordingly. Provide DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_USER,
ADMIN_PASSWORD, and SESSION_SECRET as runtime environment variables or secrets.
For private RDS, the hosting service needs network access to its VPC and the
RDS security group must allow the application's connection on port 3306.

Do not bake credentials into the Docker image. `.env` files are excluded from
both Git and the Docker build context. Use HTTPS and a least-privilege database
account for deployed access.

## Final step: updating Lambda after future changes

Amplify automatically builds and deploys the client after changes reach `main`.
This repository does not configure automatic Lambda deployment. For changes to
`server/`, including dependencies, deploy the server separately from the updated
checkout:

```powershell
npm ci --prefix server
npm test --prefix server
sam validate --lint
sam build
sam deploy
```

Run commands one at a time and continue only if the previous command succeeds.
`sam deploy` reuses the stack, region, and VPC settings saved during the initial
guided deployment. If this is a new checkout without `samconfig.toml`, use
`sam deploy --guided` and enter the existing stack name, region, and VPC values.
Do not create a new stack for a routine update. For changes to VPC parameters,
also use guided deployment and review the change set.

For stacks created with the current template, environment variables remain
console-managed: the template has no `Environment` property. Do not add one
unless intentionally moving configuration management into CloudFormation.
After deployment, confirm your variables are present, check `/api/health`, and
verify login and the changed functionality. A replacement function or a newly
created stack needs its variables entered again before it can serve requests.

If a stack was previously deployed with the old Secrets Manager template,
removing its managed `Environment` property can clear existing variables during
that first migration. Have the values available securely, deploy this template,
and re-enter all variables through the Lambda console before testing.

For environment-only changes, edit the existing variables in **Lambda ?
Configuration > Environment variables > Edit > Save**; no code build or upload
is required. Changing `SESSION_SECRET` invalidates existing sessions. Do not
commit environment values to Git.

Client-only changes need no Lambda deployment. Server updates normally keep the
same API URL, so no Amplify setting change is needed. If the API URL changes,
update `VITE_API_URL` in Amplify and trigger a client build. When a change affects
both client and server, deploy a backward-compatible server update before the
client change reaches `main` so Amplify's automatic deployment can use it.

## Migrating the existing deployment from cookies to bearer tokens

1. Set a new strong `SESSION_SECRET` in Lambda environment variables. The server
   accepts the old `COOKIE_SECRET` as a compatibility fallback, but rotate to a
   fresh secret for this migration. Remove `COOKIE_SAME_SITE`; it is unused.
2. Keep `CORS_ORIGINS=https://main.d1zupn0rwkco30.amplifyapp.com` and keep Amplify's
   `VITE_API_URL=https://4ow9xllfw2.execute-api.ap-south-1.amazonaws.com/api`.
3. Run `npm ci --prefix server`, `npm test --prefix server`, `sam build`, and
   `sam deploy`, stopping on any failure. Lambda must be deployed for this change.
4. Push the client changes to `main` and wait for Amplify's automatic build.
   Coordinate these deployments: the old client cannot use the new token login.
5. Refresh the app and sign in again on desktop/mobile. Login should return a
   token and subsequent requests should carry Authorization and return 200.
   Existing cookie sessions are deliberately rejected and need a new login.
