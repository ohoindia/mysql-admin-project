import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { getToken, saveToken, clearToken } from './services/session';

// Vite embeds the Amplify API URL during the build. Keep /api for local/Docker.
const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

const api = async (url, options = {}) => {
  const endpoint = `${apiBaseUrl}${url.replace(/^\/api(?=\/|$)/, '')}`;
  const token = getToken();
  const response = await fetch(endpoint, {
    ...options,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) clearToken();
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }

  if (url === '/api/auth/login') saveToken(data.token);
  return data;
};

const getInputType = (column) => {
  const type = String(column?.dataType || '').toLowerCase();

  if (type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(type)) return 'datetime-local';
  if (type === 'time') return 'time';
  if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'].includes(type)) {
    return 'number';
  }

  return 'text';
};

const getInputStep = (column) => {
  const type = String(column?.dataType || '').toLowerCase();

  if (['decimal', 'numeric', 'float', 'double', 'real'].includes(type)) return 'any';
  if (['datetime', 'timestamp', 'time'].includes(type)) return '1';
  return undefined;
};

const formatValueForInput = (column, value) => {
  if (value === null || value === undefined) return '';

  const type = String(column?.dataType || '').toLowerCase();
  const text = String(value);

  if (type === 'date') {
    return text.slice(0, 10);
  }

  if (['datetime', 'timestamp'].includes(type)) {
    return text.replace(' ', 'T').slice(0, 19);
  }

  if (type === 'time') {
    return text.slice(0, 8);
  }

  return text;
};

const buildEditableValues = (schema, row) => {
  const values = {};

  schema.forEach((column) => {
    values[column.name] = formatValueForInput(column, row?.[column.name]);
  });

  return values;
};

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(result.username);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>MySQL Data Manager</h1>
        <p>Sign in to view and update application data.</p>

        {message && <div className="error-msg">{message}</div>}

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="primary" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [tables, setTables] = useState([]);
  const [table, setTable] = useState('');
  const [schema, setSchema] = useState([]);
  const [rows, setRows] = useState([]);

  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [tableSearch, setTableSearch] = useState('');
  const [dataSearch, setDataSearch] = useState('');
  const [filters, setFilters] = useState({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState('ASC');

  const handleError = (err) => {
    if (err.status === 401) {
      setUser(null);
      setTables([]);
      setTable('');
      setSchema([]);
      setRows([]);
      return;
    }

    setError(err.message);
  };

  const loadTables = async () => {
    try {
      setTables(await api('/api/tables'));
    } catch (err) {
      handleError(err);
    }
  };

  useEffect(() => {
    api('/api/auth/me')
      .then((result) => {
        setUser(result.username);
        return loadTables();
      })
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  const afterLogin = async (username) => {
    setUser(username);
    setCheckingAuth(false);
    await loadTables();
  };

  const load = async (
    selectedTable,
    requestedPage = 1,
    searchText = dataSearch,
    currentFilters = filters,
    requestedPageSize = pageSize,
    requestedSortColumn = sortColumn,
    requestedSortDirection = sortDirection
  ) => {
    setLoading(true);
    setTable(selectedTable);
    setMessage('');
    setError('');

    try {
      const query = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(requestedPageSize),
      });

      if (searchText?.trim()) {
        query.set('search', searchText.trim());
      }

      if (requestedSortColumn) {
        query.set('sortColumn', requestedSortColumn);
        query.set('sortDirection', requestedSortDirection || 'ASC');
      }

      const activeFilters = Object.fromEntries(
        Object.entries(currentFilters || {}).filter(
          ([, value]) => value !== null && value !== undefined && String(value).trim() !== ''
        )
      );

      if (Object.keys(activeFilters).length > 0) {
        query.set('filters', JSON.stringify(activeFilters));
      }

      const [tableSchema, result] = await Promise.all([
        api(`/api/tables/${encodeURIComponent(selectedTable)}/schema`),
        api(`/api/tables/${encodeURIComponent(selectedTable)}/rows?${query.toString()}`),
      ]);

      setSchema(tableSchema);
      setRows(result.data || []);
      setPage(result.pagination?.page || 1);
      setTotalRows(result.pagination?.total || 0);
      setTotalPages(result.pagination?.totalPages || 0);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const selectTable = async (tableName) => {
    setDataSearch('');
    setFilters({});
    setPage(1);
    setEditing(null);
    setAdding(false);
    setNewRow({});
    setSortColumn('');
    setSortDirection('ASC');

    await load(tableName, 1, '', {}, pageSize, '', 'ASC');
  };

  const primaryKey = schema.find((column) => column.columnKey === 'PRI')?.name || schema[0]?.name;

  const filteredTables = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    if (!search) return tables;
    return tables.filter((item) => item.name.toLowerCase().includes(search));
  }, [tables, tableSearch]);

  const performSearch = () => {
    setPage(1);
    load(table, 1, dataSearch, filters, pageSize, sortColumn, sortDirection);
  };

  const clearSearch = () => {
    setDataSearch('');
    setFilters({});
    setPage(1);
    load(table, 1, '', {}, pageSize, sortColumn, sortDirection);
  };

  const handleSort = async (columnName) => {
    const direction = sortColumn === columnName && sortDirection === 'ASC' ? 'DESC' : 'ASC';

    setSortColumn(columnName);
    setSortDirection(direction);
    setPage(1);

    await load(table, 1, dataSearch, filters, pageSize, columnName, direction);
  };

  const openAdd = () => {
    const initialValues = {};

    schema.forEach((column) => {
      if (String(column.extra || '').toLowerCase().includes('auto_increment')) return;
      initialValues[column.name] = '';
    });

    setNewRow(initialValues);
    setAdding(true);
  };

  const insertRow = async () => {
    setError('');
    setMessage('');

    try {
      await api(`/api/tables/${encodeURIComponent(table)}/rows`, {
        method: 'POST',
        body: JSON.stringify({ values: newRow }),
      });

      setAdding(false);
      setNewRow({});

      await load(table, 1, dataSearch, filters, pageSize, sortColumn, sortDirection);
      setMessage('New row inserted successfully.');
    } catch (err) {
      handleError(err);
    }
  };

  const save = async () => {
    if (!editing || !primaryKey) return;

    setError('');
    setMessage('');

    try {
      const keyValue = editing.original[primaryKey];
      const values = { ...editing.values };
      delete values[primaryKey];

      await api(`/api/tables/${encodeURIComponent(table)}/rows`, {
        method: 'PUT',
        body: JSON.stringify({ keyColumn: primaryKey, keyValue, values }),
      });

      setEditing(null);
      await load(table, page, dataSearch, filters, pageSize, sortColumn, sortDirection);
      setMessage('Updated successfully.');
    } catch (err) {
      handleError(err);
    }
  };

  const remove = async (row) => {
    if (!primaryKey) return;

    const confirmed = window.confirm(
      `Delete row where ${primaryKey} = ${row[primaryKey]}?`
    );
    if (!confirmed) return;

    setError('');
    setMessage('');

    try {
      await api(`/api/tables/${encodeURIComponent(table)}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ keyColumn: primaryKey, keyValue: row[primaryKey] }),
      });

      const targetPage = rows.length === 1 && page > 1 ? page - 1 : page;
      await load(table, targetPage, dataSearch, filters, pageSize, sortColumn, sortDirection);
      setMessage('Deleted successfully.');
    } catch (err) {
      handleError(err);
    }
  };

  const logout = async () => {
    clearToken();
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setTables([]);
    setTable('');
    setSchema([]);
    setRows([]);
  };

  const renderField = (column, value, onChange, disabled = false) => {
    const type = getInputType(column);
    const step = getInputStep(column);

    return (
      <input
        type={type}
        step={step}
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={column.columnType || column.dataType}
      />
    );
  };

  if (checkingAuth) return <div className="center-page">Loading...</div>;
  if (!user) return <Login onLogin={afterLogin} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>MySQL Admin</h2>
          <div className="user">
            Signed in as
            <strong>{user}</strong>
          </div>
        </div>

        <div className="table-search-container">
          <input
            className="table-search"
            type="search"
            placeholder="Search tables..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </div>

        <div className="table-count">
          {filteredTables.length} of {tables.length} tables
        </div>

        <div className="table-list">
          {filteredTables.map((item) => (
            <button
              key={item.name}
              className={table === item.name ? 'active' : ''}
              onClick={() => selectTable(item.name)}
            >
              <span>{item.name}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="logout" onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="page-title">
          <div className="page-heading">
            <h1>{table || 'Select a table'}</h1>
            {table && <span>Total {totalRows} records</span>}
          </div>

          {table && (
            <div className="page-actions">
              <button className="primary" onClick={openAdd}>+ New Row</button>
              <button
                className="refresh-btn"
                onClick={() => load(table, page, dataSearch, filters, pageSize, sortColumn, sortDirection)}
              >
                Refresh
              </button>
            </div>
          )}
        </div>

        {message && <div className="msg">{message}</div>}
        {error && <div className="error-msg">{error}</div>}

        {table && (
          <>
            <div className="data-toolbar">
              <div className="search-box">
                <input
                  type="search"
                  placeholder={`Search ${table}...`}
                  value={dataSearch}
                  onChange={(e) => setDataSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') performSearch();
                  }}
                />
              </div>

              <button className="primary" onClick={performSearch}>Search</button>
              <button onClick={clearSearch}>Clear</button>

              <div className="result-count">
                Total: <strong>{totalRows}</strong>
              </div>
            </div>

            <div className="filters">
              {schema.map((column) => (
                <div className="column-filter" key={column.name}>
                  <label>{column.name}</label>
                  <input
                    placeholder={`Filter ${column.name}`}
                    value={filters[column.name] || ''}
                    onChange={(e) => setFilters({ ...filters, [column.name]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') performSearch();
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {loading && <div className="loading">Loading table data...</div>}

        {table && !loading && (
          <>
            <div className="table-container">
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      {schema.map((column) => (
                        <th
                          key={column.name}
                          className="sortable-header"
                          onClick={() => handleSort(column.name)}
                        >
                          <div className="header-content">
                            <span>{column.name}</span>
                            <span className="sort-icon">
                              {sortColumn === column.name
                                ? sortDirection === 'ASC' ? '▲' : '▼'
                                : '↕'}
                            </span>
                          </div>
                        </th>
                      ))}
                      <th className="actions-header">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.length > 0 ? (
                      rows.map((row, index) => (
                        <tr key={String(row[primaryKey] ?? index)}>
                          {schema.map((column) => (
                            <td key={column.name} title={String(row[column.name] ?? '')}>
                              {String(row[column.name] ?? '')}
                            </td>
                          ))}

                          <td className="actions">
                            <button
                              onClick={() => setEditing({
                                original: row,
                                values: buildEditableValues(schema, row),
                              })}
                            >
                              Edit
                            </button>
                            <button className="danger" onClick={() => remove(row)}>Delete</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={schema.length + 1} className="no-data">No records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pagination-bar">
              <div className="pagination-info">
                Page <strong>{page}</strong> of <strong>{Math.max(totalPages, 1)}</strong>
                {' | '}{totalRows} records
              </div>

              <div className="pagination-controls">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const newSize = Number(e.target.value);
                    setPageSize(newSize);
                    setPage(1);
                    load(table, 1, dataSearch, filters, newSize, sortColumn, sortDirection);
                  }}
                >
                  <option value="25">25 rows</option>
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="200">200 rows</option>
                </select>

                <button
                  disabled={page <= 1}
                  onClick={() => load(table, page - 1, dataSearch, filters, pageSize, sortColumn, sortDirection)}
                >
                  Previous
                </button>

                <button
                  disabled={page >= totalPages}
                  onClick={() => load(table, page + 1, dataSearch, filters, pageSize, sortColumn, sortDirection)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {!table && (
          <div className="empty-state">
            <div className="empty-icon">DB</div>
            <h2>Select a database table</h2>
            <p>Select a table from the left side.</p>
          </div>
        )}
      </main>

      {adding && (
        <div className="modal">
          <div className="card">
            <div className="modal-header">
              <div>
                <h3>Add New Row - {table}</h3>
                <span>Date/time fields use native date/time pickers.</span>
              </div>
              <button className="modal-close" onClick={() => setAdding(false)}>×</button>
            </div>

            <div className="modal-body">
              <div className="edit-grid">
                {schema
                  .filter((column) => !String(column.extra || '').toLowerCase().includes('auto_increment'))
                  .map((column) => (
                    <label key={column.name}>
                      <span>
                        {column.name}
                        {column.isNullable === 'NO' && column.columnDefault == null && (
                          <small className="required"> *</small>
                        )}
                        <small className="field-type"> {column.columnType || column.dataType}</small>
                      </span>

                      {renderField(
                        column,
                        newRow[column.name] ?? '',
                        (value) => setNewRow({ ...newRow, [column.name]: value })
                      )}
                    </label>
                  ))}
              </div>
            </div>

            <div className="modal-buttons">
              <button className="primary" onClick={insertRow}>Insert Row</button>
              <button onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal">
          <div className="card">
            <div className="modal-header">
              <div>
                <h3>Edit {table}</h3>
                <span>{primaryKey}: {String(editing.original[primaryKey] ?? '')}</span>
              </div>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="modal-body">
              <div className="edit-grid">
                {schema.map((column) => (
                  <label key={column.name}>
                    <span>
                      {column.name}
                      {column.name === primaryKey && <small> (Primary Key)</small>}
                      <small className="field-type"> {column.columnType || column.dataType}</small>
                    </span>

                    {renderField(
                      column,
                      editing.values[column.name] ?? '',
                      (value) => setEditing({
                        ...editing,
                        values: { ...editing.values, [column.name]: value },
                      }),
                      column.name === primaryKey
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-buttons">
              <button className="primary" onClick={save}>Save Changes</button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
