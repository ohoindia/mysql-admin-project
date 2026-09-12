import { useEffect, useState } from 'react'

export default function RecordModal({ mode, schema, row, onClose, onSave }) {
  const [values, setValues] = useState({})
  useEffect(() => setValues(row || {}), [row])

  const editableColumns = schema.columns.filter(c => !(mode === 'insert' && c.primary_key && c.autoincrement))

  const inputType = (type) => {
    const t = type.toLowerCase()
    if (t.includes('date') || t.includes('time')) return 'text'
    if (t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('double')) return 'number'
    return 'text'
  }

  return <div className="modal-backdrop">
    <div className="modal">
      <h3>{mode === 'insert' ? 'Add Record' : 'Edit Record'}</h3>
      <div className="form-grid">
        {editableColumns.map(col => <label key={col.name}>
          <span>{col.name}{col.primary_key ? ' (PK)' : ''}</span>
          <input
            type={inputType(col.type)}
            disabled={mode === 'edit' && col.primary_key}
            value={values[col.name] ?? ''}
            onChange={e => setValues(v => ({ ...v, [col.name]: e.target.value }))}
            placeholder={col.nullable ? 'Optional' : 'Required'}
          />
        </label>)}
      </div>
      <div className="modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button onClick={() => onSave(values)}>{mode === 'insert' ? 'Insert' : 'Update'}</button></div>
    </div>
  </div>
}
