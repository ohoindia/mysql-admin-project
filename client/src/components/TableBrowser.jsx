import { buildEditableValues } from '../utils/fields';

export default function TableBrowser({ browser, superUser }) {
  const { table, schema, rows, setEditing, message, error, loading, dataSearch, setDataSearch, filters, setFilters, page, setPage, pageSize, setPageSize, totalRows, totalPages, sortColumn, sortDirection, primaryKey, load, performSearch, clearSearch, handleSort, openAdd, remove } = browser;
  return <>
        <div className="page-title">
          <div className="page-heading">
            <h1>{table || 'Select a table'}</h1>
            {table && <span>Total {totalRows} records</span>}
          </div>

          {table && (
            <div className="page-actions">
              <button className="primary" disabled={loading} onClick={openAdd}>+ New Row</button>
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
              <div className="tablewrap" tabIndex={0} role="region" aria-label="Table records, scroll to view more columns">
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
                            {superUser && <button
                              disabled={schema.filter(c => c.columnKey === 'PRI').length !== 1}
                              onClick={() => setEditing({
                                original: row,
                                values: buildEditableValues(schema, row),
                              })}
                            >
                              Edit
                            </button>}
                            <button className="danger" disabled={!primaryKey} onClick={() => remove(row)}>Delete</button>
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

  </>;
}
