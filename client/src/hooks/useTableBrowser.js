import { useEffect, useRef, useState } from 'react';
import { request as api } from '../services/api';
import { createLatestRequest } from '../utils/requests';

export default function useTableBrowser() {
  const requests = useRef(createLatestRequest());
  useEffect(() => {
    const current = requests.current;
    return () => current.cancel();
  }, []);
  const [table, setTable] = useState('');
  const [schema, setSchema] = useState([]);
  const [rows, setRows] = useState([]);

  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [dataSearch, setDataSearch] = useState('');
  const [filters, setFilters] = useState({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState('ASC');

  const handleError = (err) => { if (err.code !== 'ERR_CANCELED') setError(err.message); };

  const load = async (
    selectedTable,
    requestedPage = 1,
    searchText = dataSearch,
    currentFilters = filters,
    requestedPageSize = pageSize,
    requestedSortColumn = sortColumn,
    requestedSortDirection = sortDirection
  ) => {
    const controller = requests.current.start();
    setLoading(true);
    setTable(selectedTable);
    if (selectedTable !== table) { setSchema([]); setRows([]); }
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
        api(`/api/tables/${encodeURIComponent(selectedTable)}/schema`, { signal: controller.signal }),
        api(`/api/tables/${encodeURIComponent(selectedTable)}/rows?${query.toString()}`, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;
      setSchema(tableSchema);
      setRows(result.data || []);
      setPage(result.pagination?.page || 1);
      setTotalRows(result.pagination?.total || 0);
      setTotalPages(result.pagination?.totalPages || 0);
    } catch (err) {
      if (!controller.signal.aborted) handleError(err);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
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

  const primaryKeys = schema.filter(column => column.columnKey === 'PRI');
  const primaryKey = primaryKeys.length === 1 ? primaryKeys[0].name : undefined;

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

  return { table, schema, rows, editing, setEditing, adding, setAdding, newRow, setNewRow, message, error, loading, dataSearch, setDataSearch, filters, setFilters, page, setPage, pageSize, setPageSize, totalRows, totalPages, sortColumn, sortDirection, primaryKey, load, selectTable, performSearch, clearSearch, handleSort, openAdd, insertRow, save, remove };
}
