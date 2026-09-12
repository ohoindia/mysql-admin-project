export default function TableSidebar({ tables, selected, onSelect }) {
  return <aside className="sidebar">
    <h2>Tables</h2>
    <div className="table-list">
      {tables.map(t => <button key={t} className={selected === t ? 'active' : ''} onClick={() => onSelect(t)}>{t}</button>)}
    </div>
  </aside>
}
