import { useEffect, useState } from 'react'
import api from './services/api'
import TableSidebar from './components/TableSidebar'
import RecordModal from './components/RecordModal'

export default function App() {
  const [tables, setTables] = useState([])
  const [selected, setSelected] = useState('')
  const [schema, setSchema] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ column: '', direction: 'asc' })
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tables').then(r => {
      setTables(r.data.tables)
      if (r.data.tables.length) setSelected(r.data.tables[0])
    }).catch(e => setError(e.response?.data?.detail || e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    setPage(1)
    api.get(`/tables/${encodeURIComponent(selected)}/schema`).then(r => setSchema(r.data)).catch(e => setError(e.response?.data?.detail || e.message))
  }, [selected])

  useEffect(() => { if (selected) loadData() }, [selected, page, pageSize, sort])

  async function loadData(customSearch = search) {
    if (!selected) return
    setLoading(true); setError('')
    try {
      const r = await api.post(`/tables/${encodeURIComponent(selected)}/query`, {
        page, page_size: pageSize, search: customSearch || null,
        sort_column: sort.column || null, sort_direction: sort.direction
      })
      setRows(r.data.rows); setTotal(r.data.total)
    } catch (e) { setError(e.response?.data?.detail || e.message) }
    finally { setLoading(false) }
  }

  function changeSort(column) {
    setSort(s => ({ column, direction: s.column === column && s.direction === 'asc' ? 'desc' : 'asc' }))
  }

  async function save(values) {
    try {
      if (modal.mode === 'insert') await api.post(`/tables/${encodeURIComponent(selected)}`, { values })
      else {
        const pk = {}; schema.primary_key.forEach(k => pk[k] = modal.row[k])
        await api.put(`/tables/${encodeURIComponent(selected)}`, { pk, values })
      }
      setModal(null); await loadData()
    } catch (e) { alert(e.response?.data?.detail || e.message) }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return <div className="app-shell">
    <TableSidebar tables={tables} selected={selected} onSelect={setSelected} />
    <main>
      <header><div><h1>MySQL Data Manager</h1><p>{selected || 'Select a table'}</p></div>{schema && <button onClick={() => setModal({ mode: 'insert' })}>+ Add Record</button>}</header>
      <div className="toolbar">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(1), loadData(search))} placeholder="Search all columns..." />
        <button onClick={() => { setPage(1); loadData(search) }}>Search</button>
        <button className="secondary" onClick={() => { setSearch(''); setPage(1); loadData('') }}>Clear</button>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option>25</option><option>50</option><option>100</option></select>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid-wrap">
        {loading ? <div className="loading">Loading...</div> : <table><thead><tr>{schema?.columns.map(c => <th key={c.name} onClick={() => changeSort(c.name)}>{c.name}{sort.column === c.name ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}<th>Action</th></tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{schema?.columns.map(c => <td key={c.name}>{row[c.name] == null ? <span className="null">NULL</span> : String(row[c.name])}</td>)}<td><button className="small" disabled={!schema?.primary_key?.length} onClick={() => setModal({ mode: 'edit', row })}>Edit</button></td></tr>)}</tbody></table>}
      </div>
      <footer><span>{total.toLocaleString()} records</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button></div></footer>
    </main>
    {modal && schema && <RecordModal mode={modal.mode} schema={schema} row={modal.row} onClose={() => setModal(null)} onSave={save} />}
  </div>
}
