const path = require('path');
const dotenv = require('dotenv');

// Lambda receives configuration from its environment, never a bundled .env.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) dotenv.config({
  path: path.join(__dirname, '.env'),
  quiet: true,
});

const express = require('express');
const mysql = require('mysql2/promise');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);

const isProduction =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.AWS_REGION);

/* =========================================================
   MIDDLEWARE
========================================================= */

app.disable('x-powered-by');

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const cookieSameSite = process.env.COOKIE_SAME_SITE || 'lax';
if (!['lax', 'strict', 'none'].includes(cookieSameSite)) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
}

// Check origins before processing requests, including cookie-authenticated writes.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  res.vary('Origin');
  if (origin) {
    const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
    if (!sameOrigin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(
  express.json({
    limit: '2mb',
  })
);

app.use(cookieParser());

// Retain static hosting for the existing Docker deployment.
app.use(express.static(path.join(__dirname, 'public')));

/* =========================================================
   ENVIRONMENT VALIDATION
========================================================= */

const requiredEnv = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'ADMIN_USER',
  'ADMIN_PASSWORD',
  'COOKIE_SECRET',
];

const missingEnv = requiredEnv.filter(
  (name) => !process.env[name]
);

if (missingEnv.length) {
  if (isProduction) {
    throw new Error(`Missing environment variables: ${missingEnv.join(', ')}`);
  }
  console.warn(
    `Missing environment variables: ${missingEnv.join(', ')}`
  );
}

/* =========================================================
   MYSQL CONNECTION
========================================================= */

const pool = mysql.createPool({
  host: process.env.DB_HOST,

  port: Number(
    process.env.DB_PORT || 3306
  ),

  user: process.env.DB_USER,

  password: process.env.DB_PASSWORD,

  database: process.env.DB_NAME,

  waitForConnections: true,

  connectionLimit: Number(
    process.env.DB_POOL_SIZE || (process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 5)
  ),

  queueLimit: 0,

  /*
   * Very important for the admin UI.
   *
   * Without this mysql2 may convert DATE/DATETIME values
   * into JavaScript Date objects and timezone conversion
   * can change the displayed value.
   *
   * With dateStrings:true:
   *
   * DATE:
   * 2026-08-25
   *
   * DATETIME:
   * 2026-08-25 15:00:00
   *
   * TIMESTAMP:
   * 2026-08-25 15:00:00
   */
  dateStrings: true,
});

/* =========================================================
   ALLOWED TABLES
========================================================= */

const allowedTables =
  process.env.ALLOWED_TABLES
    ? process.env.ALLOWED_TABLES
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : null;

/*
 * Table names cannot be passed as SQL parameters.
 *
 * Therefore table names must always be validated before
 * being included in SQL.
 */
const validateTable = (tableName) => {
  if (
    !tableName ||
    !/^[A-Za-z0-9_]+$/.test(tableName)
  ) {
    const error = new Error(
      'Invalid table name'
    );

    error.status = 400;

    throw error;
  }

  if (
    allowedTables &&
    !allowedTables.includes(tableName)
  ) {
    const error = new Error(
      'Table is not allowed'
    );

    error.status = 403;

    throw error;
  }
};

/* =========================================================
   SESSION / AUTHENTICATION
========================================================= */

const SESSION_COOKIE =
  'mysql_admin_session';

const SESSION_DURATION =
  12 * 60 * 60 * 1000;

/*
 * Create a signed session token.
 */
const createSession = (username) => {
  const timestamp = Date.now();

  const payload =
    `${username}:${timestamp}`;

  const signature = crypto
    .createHmac(
      'sha256',
      process.env.COOKIE_SECRET ||
        'development-secret'
    )
    .update(payload)
    .digest('hex');

  return Buffer.from(
    `${payload}:${signature}`
  ).toString('base64');
};

/*
 * Validate session token.
 */
const verifySession = (value) => {
  try {
    if (!value) {
      return null;
    }

    const decoded = Buffer.from(
      value,
      'base64'
    ).toString('utf8');

    const parts = decoded.split(':');

    if (parts.length !== 3) {
      return null;
    }

    const [
      username,
      timestamp,
      signature,
    ] = parts;

    const payload =
      `${username}:${timestamp}`;

    const expectedSignature = crypto
      .createHmac(
        'sha256',
        process.env.COOKIE_SECRET ||
          'development-secret'
      )
      .update(payload)
      .digest('hex');

    /*
     * Use timingSafeEqual instead of normal string
     * comparison for signatures.
     */
    const actualBuffer =
      Buffer.from(signature);

    const expectedBuffer =
      Buffer.from(expectedSignature);

    if (
      actualBuffer.length !==
      expectedBuffer.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        actualBuffer,
        expectedBuffer
      )
    ) {
      return null;
    }

    const sessionTime =
      Number(timestamp);

    if (
      !Number.isFinite(sessionTime)
    ) {
      return null;
    }

    if (
      Date.now() - sessionTime >
      SESSION_DURATION
    ) {
      return null;
    }

    return username;
  } catch {
    return null;
  }
};

/*
 * Authentication middleware.
 */
const requireAuth = (
  req,
  res,
  next
) => {
  const session =
    req.cookies[SESSION_COOKIE];

  const username =
    verifySession(session);

  if (!username) {
    return res
      .status(401)
      .json({
        error: 'Unauthorized',
      });
  }

  req.username = username;

  next();
};

/* =========================================================
   HELPER - GET TABLE SCHEMA
========================================================= */

const getTableSchema =
  async (tableName) => {
    const [columns] =
      await pool.query(
        `
        SELECT
          COLUMN_NAME AS name,
          DATA_TYPE AS dataType,
          COLUMN_TYPE AS columnType,
          IS_NULLABLE AS isNullable,
          COLUMN_KEY AS columnKey,
          COLUMN_DEFAULT AS columnDefault,
          EXTRA AS extra,
          ORDINAL_POSITION AS ordinalPosition
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        `,
        [
          process.env.DB_NAME,
          tableName,
        ]
      );

    return columns;
  };

/* =========================================================
   HELPER - DATE/DATETIME NORMALIZATION
========================================================= */

/*
 * Browser datetime-local returns:
 *
 * 2026-08-25T15:30
 *
 * MySQL DATETIME expects:
 *
 * 2026-08-25 15:30:00
 */
const normalizeDateValue = (
  value,
  dataType
) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return value;
  }

  const type =
    String(dataType || '')
      .toLowerCase();

  const stringValue =
    String(value);

  /*
   * DATE
   */
  if (type === 'date') {
    return stringValue.substring(
      0,
      10
    );
  }

  /*
   * DATETIME / TIMESTAMP
   */
  if (
    type === 'datetime' ||
    type === 'timestamp'
  ) {
    let normalized =
      stringValue.replace(
        'T',
        ' '
      );

    /*
     * Browser may provide:
     * 2026-08-25 15:30
     *
     * Add seconds.
     */
    if (
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(
        normalized
      )
    ) {
      normalized += ':00';
    }

    return normalized;
  }

  /*
   * TIME
   */
  if (type === 'time') {
    if (
      /^\d{2}:\d{2}$/.test(
        stringValue
      )
    ) {
      return `${stringValue}:00`;
    }

    return stringValue;
  }

  return value;
};

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  '/api/health',
  async (req, res) => {
    try {
      await pool.query(
        'SELECT 1'
      );

      res.json({
        status: 'OK',
        database: 'connected',
      });
    } catch (error) {
      console.error(
        'Database health check failed:',
        error
      );

      res
        .status(500)
        .json({
          status: 'ERROR',
          database:
            'disconnected',
          error:
            error.message,
        });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  '/api/auth/login',
  (req, res) => {
    const {
      username,
      password,
    } = req.body || {};

    const adminUser =
      process.env.ADMIN_USER;

    const adminPassword =
      process.env
        .ADMIN_PASSWORD;

    if (
      !adminUser ||
      !adminPassword
    ) {
      return res
        .status(500)
        .json({
          error:
            'Admin login is not configured.',
        });
    }

    if (
      username !== adminUser ||
      password !==
        adminPassword
    ) {
      return res
        .status(401)
        .json({
          error:
            'Invalid username or password.',
        });
    }

    const session =
      createSession(username);

    res.cookie(
      SESSION_COOKIE,
      session,
      {
        httpOnly: true,

        secure:
          isProduction || cookieSameSite === 'none',

        sameSite: cookieSameSite,

        maxAge:
          SESSION_DURATION,

        path: '/',
      }
    );

    res.json({
      username,
    });
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  '/api/auth/me',
  requireAuth,
  (req, res) => {
    res.json({
      username:
        req.username,
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  '/api/auth/logout',
  (req, res) => {
    res.clearCookie(
      SESSION_COOKIE,
      {
        httpOnly: true,
        secure:
          isProduction || cookieSameSite === 'none',
        sameSite: cookieSameSite,
        path: '/',
      }
    );

    res.json({
      success: true,
    });
  }
);

/* =========================================================
   GET TABLES
========================================================= */

app.get(
  '/api/tables',
  requireAuth,
  async (req, res) => {
    try {
      const [rows] =
        await pool.query(
          `
          SELECT
            TABLE_NAME AS name
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
            AND TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_NAME ASC
          `,
          [
            process.env.DB_NAME,
          ]
        );

      /*
       * Apply optional whitelist.
       */
      const result =
        allowedTables
          ? rows.filter(
              (row) =>
                allowedTables.includes(
                  row.name
                )
            )
          : rows;

      res.json(result);
    } catch (error) {
      console.error(
        'Load tables error:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'Unable to load tables.',
        });
    }
  }
);

/* =========================================================
   GET TABLE SCHEMA
========================================================= */

app.get(
  '/api/tables/:table/schema',
  requireAuth,
  async (req, res) => {
    try {
      const tableName =
        req.params.table;

      validateTable(
        tableName
      );

      const columns =
        await getTableSchema(
          tableName
        );

      if (
        columns.length === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Table not found.',
          });
      }

      res.json(columns);
    } catch (error) {
      console.error(
        'Schema error:',
        error
      );

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'Unable to load schema.',
        });
    }
  }
);

/* =========================================================
   GET ROWS
   SERVER-SIDE SEARCH
   FILTER
   PAGINATION
   ASC / DESC SORTING
========================================================= */

app.get(
  '/api/tables/:table/rows',
  requireAuth,
  async (req, res) => {
    try {
      const tableName =
        req.params.table;

      validateTable(
        tableName
      );

      let {
        page = 1,
        pageSize = 50,
        search = '',
        filters = '',
        sortColumn = '',
        sortDirection = 'ASC',
      } = req.query;

      /*
       * Convert pagination to safe integers.
       */
      page =
        Math.max(
          parseInt(page, 10) ||
            1,
          1
        );

      pageSize =
        Math.min(
          Math.max(
            parseInt(
              pageSize,
              10
            ) || 50,
            1
          ),
          200
        );

      const offset =
        (page - 1) *
        pageSize;

      /*
       * Get table schema.
       */
      const columns =
        await getTableSchema(
          tableName
        );

      if (
        columns.length === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Table not found.',
          });
      }

      const validColumns =
        columns.map(
          (column) =>
            column.name
        );

      const whereParts = [];

      const params = [];

      /* =============================================
         GLOBAL SEARCH
      ============================================= */

      const cleanSearch =
        String(
          search || ''
        ).trim();

      if (cleanSearch) {
        const searchValue =
          `%${cleanSearch}%`;

        /*
         * Do not attempt LIKE searches against binary
         * or blob columns.
         */
        const searchableColumns =
          columns.filter(
            (column) =>
              ![
                'blob',
                'tinyblob',
                'mediumblob',
                'longblob',
                'binary',
                'varbinary',
              ].includes(
                String(
                  column.dataType
                ).toLowerCase()
              )
          );

        const searchConditions =
          searchableColumns.map(
            (column) => {
              params.push(
                searchValue
              );

              return (
                `CAST(\`${column.name}\` AS CHAR) LIKE ?`
              );
            }
          );

        if (
          searchConditions.length
        ) {
          whereParts.push(
            `(${searchConditions.join(
              ' OR '
            )})`
          );
        }
      }

      /* =============================================
         COLUMN WHERE FILTERS
      ============================================= */

      if (filters) {
        let parsedFilters;

        try {
          parsedFilters =
            typeof filters ===
            'string'
              ? JSON.parse(
                  filters
                )
              : filters;
        } catch {
          return res
            .status(400)
            .json({
              error:
                'Invalid filter format.',
            });
        }

        if (
          parsedFilters &&
          typeof parsedFilters ===
            'object' &&
          !Array.isArray(
            parsedFilters
          )
        ) {
          for (
            const [
              columnName,
              filterValue,
            ] of Object.entries(
              parsedFilters
            )
          ) {
            /*
             * Never allow arbitrary column names.
             */
            if (
              !validColumns.includes(
                columnName
              )
            ) {
              continue;
            }

            if (
              filterValue ===
                null ||
              filterValue ===
                undefined ||
              String(
                filterValue
              ).trim() === ''
            ) {
              continue;
            }

            const column =
              columns.find(
                (item) =>
                  item.name ===
                  columnName
              );

            const dataType =
              String(
                column?.dataType ||
                  ''
              ).toLowerCase();

            /*
             * DATE filters.
             *
             * If React sends:
             *
             * DateofBirth = 1990-01-01
             *
             * use equality instead of LIKE.
             */
            if (
              dataType ===
              'date'
            ) {
              whereParts.push(
                `\`${columnName}\` = ?`
              );

              params.push(
                normalizeDateValue(
                  filterValue,
                  dataType
                )
              );

              continue;
            }

            /*
             * Other columns currently use Contains.
             */
            whereParts.push(
              `CAST(\`${columnName}\` AS CHAR) LIKE ?`
            );

            params.push(
              `%${String(
                filterValue
              ).trim()}%`
            );
          }
        }
      }

      const whereClause =
        whereParts.length
          ? `WHERE ${whereParts.join(
              ' AND '
            )}`
          : '';

      /* =============================================
         ASC / DESC SORTING
      ============================================= */

      let orderBy = '';

      if (
        sortColumn &&
        validColumns.includes(
          sortColumn
        )
      ) {
        /*
         * Only ASC or DESC are permitted.
         */
        const direction =
          String(
            sortDirection
          ).toUpperCase() ===
          'DESC'
            ? 'DESC'
            : 'ASC';

        orderBy =
          `ORDER BY \`${sortColumn}\` ${direction}`;
      } else {
        /*
         * Default sorting:
         *
         * Primary key DESC.
         */
        const primaryKey =
          columns.find(
            (column) =>
              column.columnKey ===
              'PRI'
          );

        if (primaryKey) {
          orderBy =
            `ORDER BY \`${primaryKey.name}\` DESC`;
        }
      }

      /* =============================================
         TOTAL RECORD COUNT
      ============================================= */

      const countSql = `
        SELECT COUNT(*) AS total
        FROM \`${tableName}\`
        ${whereClause}
      `;

      const [countRows] =
        await pool.query(
          countSql,
          params
        );

      const total =
        Number(
          countRows[0]?.total ||
            0
        );

      const totalPages =
        Math.ceil(
          total / pageSize
        );

      /* =============================================
         DATA QUERY
      ============================================= */

      /*
       * pageSize and offset are numbers created by
       * parseInt and constrained above.
       *
       * Therefore they are safe to interpolate.
       */
      const dataSql = `
        SELECT *
        FROM \`${tableName}\`
        ${whereClause}
        ${orderBy}
        LIMIT ${pageSize}
        OFFSET ${offset}
      `;

      const [rows] =
        await pool.query(
          dataSql,
          params
        );

      res.json({
        data: rows,

        pagination: {
          page,
          pageSize,
          total,
          totalPages,

          hasPrevious:
            page > 1,

          hasNext:
            page < totalPages,
        },

        sort: {
          column:
            sortColumn ||
            null,

          direction:
            String(
              sortDirection
            ).toUpperCase() ===
            'DESC'
              ? 'DESC'
              : 'ASC',
        },
      });
    } catch (error) {
      console.error(
        'Load rows error:',
        error
      );

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'Unable to load rows.',
        });
    }
  }
);

/* =========================================================
   INSERT NEW ROW
========================================================= */

app.post(
  '/api/tables/:table/rows',
  requireAuth,
  async (req, res) => {
    try {
      const tableName =
        req.params.table;

      validateTable(
        tableName
      );

      const { values } =
        req.body || {};

      if (
        !values ||
        typeof values !==
          'object' ||
        Array.isArray(values)
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid insert request.',
          });
      }

      /*
       * Load actual MySQL schema.
       */
      const columns =
        await getTableSchema(
          tableName
        );

      if (
        columns.length === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Table not found.',
          });
      }

      /*
       * Do not allow the client to explicitly insert
       * into AUTO_INCREMENT columns.
       */
      const insertableColumns =
        columns.filter(
          (column) =>
            !String(
              column.extra || ''
            )
              .toLowerCase()
              .includes(
                'auto_increment'
              )
        );

      const insertColumns = [];

      const insertValues = [];

      /* =============================================
         BUILD INSERT VALUES
      ============================================= */

      for (
        const column of
        insertableColumns
      ) {
        if (
          !Object.prototype.hasOwnProperty.call(
            values,
            column.name
          )
        ) {
          continue;
        }

        let value =
          values[column.name];

        /*
         * Empty input.
         */
        if (
          value === '' ||
          value === undefined
        ) {
          /*
           * If DB has a default value, don't include
           * the column. MySQL will apply its default.
           */
          if (
            column.columnDefault !==
            null
          ) {
            continue;
          }

          /*
           * Nullable columns become NULL.
           */
          if (
            column.isNullable ===
            'YES'
          ) {
            value = null;
          }
        }

        /*
         * Convert HTML date/datetime/time values into
         * MySQL-compatible values.
         */
        if (
          value !== null
        ) {
          value =
            normalizeDateValue(
              value,
              column.dataType
            );
        }

        insertColumns.push(
          column.name
        );

        insertValues.push(
          value
        );
      }

      /* =============================================
         VALIDATE REQUIRED COLUMNS
      ============================================= */

      const missingRequired =
        insertableColumns.filter(
          (column) => {
            /*
             * Nullable is not required.
             */
            if (
              column.isNullable ===
              'YES'
            ) {
              return false;
            }

            /*
             * Database default means frontend value
             * isn't required.
             */
            if (
              column.columnDefault !==
              null
            ) {
              return false;
            }

            const hasValue =
              Object.prototype.hasOwnProperty.call(
                values,
                column.name
              );

            if (!hasValue) {
              return true;
            }

            const value =
              values[
                column.name
              ];

            return (
              value === '' ||
              value ===
                undefined ||
              value === null
            );
          }
        );

      if (
        missingRequired.length
      ) {
        return res
          .status(400)
          .json({
            error:
              `Required fields missing: ${missingRequired
                .map(
                  (column) =>
                    column.name
                )
                .join(', ')}`,
          });
      }

      let result;

      /* =============================================
         INSERT
      ============================================= */

      if (
        insertColumns.length ===
        0
      ) {
        /*
         * Table only contains generated/default
         * columns.
         */
        [result] =
          await pool.query(
            `
            INSERT INTO \`${tableName}\`
            VALUES ()
            `
          );
      } else {
        const columnsSql =
          insertColumns
            .map(
              (column) =>
                `\`${column}\``
            )
            .join(', ');

        const placeholders =
          insertColumns
            .map(() => '?')
            .join(', ');

        const sql = `
          INSERT INTO \`${tableName}\`
          (
            ${columnsSql}
          )
          VALUES
          (
            ${placeholders}
          )
        `;

        [result] =
          await pool.query(
            sql,
            insertValues
          );
      }

      res
        .status(201)
        .json({
          success: true,

          insertId:
            result.insertId,

          affectedRows:
            result.affectedRows,
        });
    } catch (error) {
      console.error(
        'Insert error:',
        error
      );

      /*
       * Duplicate key.
       */
      if (
        error.code ===
        'ER_DUP_ENTRY'
      ) {
        return res
          .status(409)
          .json({
            error:
              'A record with the same unique value already exists.',
          });
      }

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'Insert failed.',
        });
    }
  }
);

/* =========================================================
   UPDATE ROW
========================================================= */

app.put(
  '/api/tables/:table/rows',
  requireAuth,
  async (req, res) => {
    try {
      const tableName =
        req.params.table;

      validateTable(
        tableName
      );

      const {
        keyColumn,
        keyValue,
        values,
      } = req.body || {};

      if (
        !keyColumn ||
        keyValue ===
          undefined ||
        !values ||
        typeof values !==
          'object' ||
        Array.isArray(values)
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid update request.',
          });
      }

      const columns =
        await getTableSchema(
          tableName
        );

      const validColumns =
        columns.map(
          (column) =>
            column.name
        );

      /*
       * Make sure keyColumn really belongs to table.
       */
      if (
        !validColumns.includes(
          keyColumn
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid key column.',
          });
      }

      const entries = [];

      /*
       * Only accept real columns.
       */
      for (
        const [
          columnName,
          rawValue,
        ] of Object.entries(
          values
        )
      ) {
        if (
          !validColumns.includes(
            columnName
          )
        ) {
          continue;
        }

        /*
         * Primary key is not editable.
         */
        if (
          columnName ===
          keyColumn
        ) {
          continue;
        }

        const column =
          columns.find(
            (item) =>
              item.name ===
              columnName
          );

        /*
         * Never update generated columns.
         */
        if (
          String(
            column?.extra || ''
          )
            .toLowerCase()
            .includes(
              'auto_increment'
            )
        ) {
          continue;
        }

        let value =
          rawValue;

        /*
         * Empty nullable field becomes NULL.
         */
        if (
          value === '' &&
          column?.isNullable ===
            'YES'
        ) {
          value = null;
        }

        /*
         * Normalize DATE/DATETIME/TIMESTAMP/TIME.
         */
        if (
          value !== null &&
          value !== undefined
        ) {
          value =
            normalizeDateValue(
              value,
              column?.dataType
            );
        }

        entries.push({
          columnName,
          value,
        });
      }

      if (
        entries.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              'No fields to update.',
          });
      }

      const setClause =
        entries
          .map(
            ({ columnName }) =>
              `\`${columnName}\` = ?`
          )
          .join(', ');

      const params =
        entries.map(
          ({ value }) =>
            value
        );

      params.push(keyValue);

      const sql = `
        UPDATE \`${tableName}\`
        SET ${setClause}
        WHERE \`${keyColumn}\` = ?
        LIMIT 1
      `;

      const [result] =
        await pool.query(
          sql,
          params
        );

      if (
        result.affectedRows ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Record not found.',
          });
      }

      res.json({
        success: true,

        affectedRows:
          result.affectedRows,

        changedRows:
          result.changedRows,
      });
    } catch (error) {
      console.error(
        'Update error:',
        error
      );

      if (
        error.code ===
        'ER_DUP_ENTRY'
      ) {
        return res
          .status(409)
          .json({
            error:
              'A record with the same unique value already exists.',
          });
      }

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'Update failed.',
        });
    }
  }
);

/* =========================================================
   DELETE ROW
========================================================= */

app.delete(
  '/api/tables/:table/rows',
  requireAuth,
  async (req, res) => {
    try {
      const tableName =
        req.params.table;

      validateTable(
        tableName
      );

      const {
        keyColumn,
        keyValue,
      } = req.body || {};

      if (
        !keyColumn ||
        keyValue ===
          undefined
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid delete request.',
          });
      }

      const columns =
        await getTableSchema(
          tableName
        );

      const validColumns =
        columns.map(
          (column) =>
            column.name
        );

      /*
       * Never accept arbitrary key columns.
       */
      if (
        !validColumns.includes(
          keyColumn
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid key column.',
          });
      }

      /*
       * Prefer requiring an actual PRIMARY KEY.
       *
       * This prevents accidentally deleting an
       * arbitrary row using a non-unique column.
       */
      const primaryKey =
        columns.find(
          (column) =>
            column.columnKey ===
            'PRI'
        );

      if (
        primaryKey &&
        primaryKey.name !==
          keyColumn
      ) {
        return res
          .status(400)
          .json({
            error:
              `Delete must use primary key: ${primaryKey.name}`,
          });
      }

      const sql = `
        DELETE
        FROM \`${tableName}\`
        WHERE \`${keyColumn}\` = ?
        LIMIT 1
      `;

      const [result] =
        await pool.query(
          sql,
          [keyValue]
        );

      if (
        result.affectedRows ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Record not found.',
          });
      }

      res.json({
        success: true,

        affectedRows:
          result.affectedRows,
      });
    } catch (error) {
      console.error(
        'Delete error:',
        error
      );

      /*
       * Foreign key constraint.
       */
      if (
        error.code ===
        'ER_ROW_IS_REFERENCED_2'
      ) {
        return res
          .status(409)
          .json({
            error:
              'This record cannot be deleted because other records reference it.',
          });
      }

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message ||
            'Delete failed.',
        });
    }
  }
);

/* =========================================================
   404 FOR UNKNOWN API ROUTES
========================================================= */

app.use(
  '/api',
  (req, res) => {
    res
      .status(404)
      .json({
        error:
          'API endpoint not found.',
      });
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      'Unhandled server error:',
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res
      .status(500)
      .json({
        error:
          'Internal server error.',
      });
  }
);

/* =========================================================
   START SERVER
========================================================= */

if (require.main === module) app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `MySQL Admin server running on port ${PORT}`
    );

    console.log(
      `Environment: ${
        process.env.NODE_ENV ||
        'development'
      }`
    );
  }
);

module.exports = app;
