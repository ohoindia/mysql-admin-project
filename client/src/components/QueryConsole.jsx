import { useRef, useState } from 'react'
import api from '../services/api'

const displayValue = value => value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export default function QueryConsole({ allowed, onUnauthorized }) {
  const [sql, setSql] = useState('SELECT 1 AS result;')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const editor = useRef(null)
  const busy = useRef(false)

  async function run() {
    if (busy.current || !allowed) return
    const input = editor.current
    const statement = (input?.selectionStart !== input?.selectionEnd
      ? sql.slice(input.selectionStart, input.selectionEnd) : sql).trim()
    if (!statement) return
    busy.current = true
    setRunning(true); setError(''); setResult(null)
    try {
      const response = await api.post('/query', { sql: statement })
      setResult(response.data)
    } catch (e) {
      if (e.response?.status === 401) onUnauthorized?.()
      setError(`${e.response?.data?.code ? `${e.response.data.code}: ` : ''}${e.response?.data?.error || e.message}`)
    } finally { busy.current = false; setRunning(false) }
  }

  return <section className="query-console" aria-label="SQL Console">
    <p>Run one SQL statement, or highlight the statement to execute. Ctrl/Cmd+Enter runs it.</p>
    <p>Changes are committed immediately. Each run uses a fresh connection; transactions cannot span runs. Use LIMIT for large queries; results display up to 1,000 rows per result set.</p>
    {!allowed && <div className="error-msg">SQL Console requires unrestricted table access. Sign in as the super user.</div>}
    <label htmlFor="sql-editor">SQL query</label>
    <textarea id="sql-editor" ref={editor} value={sql} onChange={e => setSql(e.target.value)}
      spellCheck={false} maxLength={100000} disabled={running || !allowed}
      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } }} />
    <div className="query-actions"><button className="primary" disabled={running || !allowed || !sql.trim()} onClick={run}>{running ? 'Running…' : 'Run query'}</button>
      <span role="status">{running ? 'Executing SQL…' : result ? `Completed in ${result.durationMs} ms` : ''}</span></div>
    {error && <div className="error-msg" role="alert">{error}</div>}
    {result?.results.map((set, index) => <section key={index} aria-label={`Result ${index + 1}`}>
      {set.columns ? <>
        <p role="status">{set.rows.length} rows returned{set.truncated ? ' — showing the first 1,000 rows. Add LIMIT to narrow results.' : ''}</p>
        <div className="query-results" tabIndex={0}><table><thead><tr>{set.columns.map((name, i) => <th key={i}>{name}</th>)}</tr></thead>
          <tbody>{set.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j} title={displayValue(value)}>{value === null ? <span className="null">NULL</span> : displayValue(value)}</td>)}</tr>)}</tbody></table>
          {!set.rows.length && <p className="no-data">Query succeeded. No rows returned.</p>}
        </div>
      </> : <div className="msg" role="status">Statement succeeded. {set.affectedRows} rows affected.{set.insertId ? ` Insert ID: ${set.insertId}.` : ''} {set.warningCount} warnings. {set.info}</div>}
    </section>)}
  </section>
}
