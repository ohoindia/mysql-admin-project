import { useEffect, useState } from 'react'
import api from './services/api'
import TableSidebar from './components/TableSidebar'
import RecordModal from './components/RecordModal'
import QueryConsole from './components/QueryConsole'

export default function App() {
  const [user, setUser] = useState(null)
  const [canRunQueries, setCanRunQueries] = useState(false)
  const [view, setView] = useState('tables')
  const [checkingSession, setCheckingSession] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
    const interceptor = api.interceptors.response.use(response => response, error => {
      if (error.response?.status === 401) setUser(null)
      return Promise.reject(error)
    })
    api.get('/auth/me').then(r => { setUser(r.data.username); setCanRunQueries(r.data.canRunQueries === true) })
      .catch(e => { if (e.response?.status !== 401) setError(e.response?.data?.error || e.message) })
      .finally(() => setCheckingSession(false))
    return () => api.interceptors.response.eject(interceptor)
  }, [])

  useEffect(() => {
    if (!user) return
    api.get('/tables').then(r => {
      const names = r.data.map(table => table.name)
      setTables(names)
      if (names.length) setSelected(names[0])
    }).catch(e => setError(e.response?.data?.error || e.message))
  }, [user])

  useEffect(() => {
    if (!selected || !user) return
    setPage(1)
    setSchema(null)
    api.get(`/tables/${encodeURIComponent(selected)}/schema`).then(r => setSchema({
      columns: r.data.map(c => ({
        name: c.name, type: c.columnType, nullable: c.isNullable === 'YES',
        primary_key: c.columnKey === 'PRI', autoincrement: c.extra.includes('auto_increment')
      })),
      primary_key: r.data.filter(c => c.columnKey === 'PRI').map(c => c.name)
    })).catch(e => setError(e.response?.data?.error || e.message))
  }, [selected, user])

  useEffect(() => { if (selected && user) loadData() }, [selected, page, pageSize, sort, user])

  async function loadData(customSearch = search) {
    if (!selected) return
    setLoading(true); setError('')
    try {
      const r = await api.get(`/tables/${encodeURIComponent(selected)}/rows`, { params: {
        page, pageSize, search: customSearch,
        sortColumn: sort.column, sortDirection: sort.direction
      } })
      setRows(r.data.data); setTotal(r.data.pagination.total)
    } catch (e) { setError(e.response?.data?.error || e.message) }
    finally { setLoading(false) }
  }

  function changeSort(column) {
    setSort(s => ({ column, direction: s.column === column && s.direction === 'asc' ? 'desc' : 'asc' }))
  }

  async function save(values) {
    try {
      if (modal.mode === 'insert') await api.post(`/tables/${encodeURIComponent(selected)}/rows`, { values })
      else {
        const keyColumn = schema.primary_key[0]
        await api.put(`/tables/${encodeURIComponent(selected)}/rows`, { keyColumn, keyValue: modal.row[keyColumn], values })
      }
      setModal(null); await loadData()
    } catch (e) { alert(e.response?.data?.error || e.message) }
  }

  async function login(event) {
    event.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/login', { username, password })
      // Confirm the bearer token authenticates before loading data.
      const session = await api.get('/auth/me')
      setUser(session.data.username); setPassword('')
      setCanRunQueries(session.data.canRunQueries === true)
    } catch (e) { setError(e.response?.status === 401
      ? 'Login failed. Check your credentials and sign in again.'
      : e.response?.data?.error || e.message) }
    finally { setLoading(false) }
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
      setUser(null); setSelected(''); setSchema(null); setRows([]); setTables([]); setModal(null)
    } catch (e) { setError(e.response?.data?.error || e.message) }
  }

  if (checkingSession) return <main>Loading session...</main>
  if (!user) return <main><form className="modal" onSubmit={login}>
    <h1>MySQL Data Manager</h1>
    <div className="form-grid">
      <label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    </div>
    {error && <div className="error">{error}</div>}
    <button disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
  </form></main>

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return <div className="app-shell">
    <TableSidebar tables={tables} selected={selected} onSelect={table => { setSelected(table); setView('tables') }} />
    <main>
      <header><div><h1>MySQL Data Manager</h1><p>{selected || 'Select a table'}</p></div>{schema && <button onClick={() => setModal({ mode: 'insert' })}>+ Add Record</button>}<button className="secondary" onClick={logout}>Sign out</button></header>
      <nav className="query-actions" aria-label="Workspace"><button className={view === 'tables' ? 'primary' : 'secondary'} onClick={() => { setView('tables'); loadData() }}>Table browser</button><button className={view === 'query' ? 'primary' : 'secondary'} onClick={() => setView('query')}>SQL Console</button></nav>
      <div hidden={view !== 'query'}><QueryConsole key={user} allowed={canRunQueries} /></div>
      {view === 'tables' && <><div className="toolbar">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(1), loadData(search))} placeholder="Search all columns..." />
        <button onClick={() => { setPage(1); loadData(search) }}>Search</button>
        <button className="secondary" onClick={() => { setSearch(''); setPage(1); loadData('') }}>Clear</button>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option>25</option><option>50</option><option>100</option></select>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid-wrap">
        {loading ? <div className="loading">Loading...</div> : <table><thead><tr>{schema?.columns.map(c => <th key={c.name} onClick={() => changeSort(c.name)}>{c.name}{sort.column === c.name ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}<th>Action</th></tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{schema?.columns.map(c => <td key={c.name}>{row[c.name] == null ? <span className="null">NULL</span> : String(row[c.name])}</td>)}<td><button className="small" disabled={schema?.primary_key?.length !== 1} onClick={() => setModal({ mode: 'edit', row })}>Edit</button></td></tr>)}</tbody></table>}
      </div>
      <footer><span>{total.toLocaleString()} records</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button></div></footer>
      </>}
    </main>
    {modal && schema && <RecordModal mode={modal.mode} schema={schema} row={modal.row} onClose={() => setModal(null)} onSave={save} />}
  </div>
}
