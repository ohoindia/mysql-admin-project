import { useDeferredValue, useState } from 'react';

export default function TableSidebar({ user, tables, table, selectTable, logout }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const search = useDeferredValue(tableSearch).trim().toLowerCase();
  const filteredTables = tables.filter(item => item.name.toLowerCase().includes(search));
  return (
      <aside className={`sidebar${navigationOpen ? ' navigation-open' : ''}`}>
        <div className="sidebar-header">
          <h2>MySQL Admin</h2>
          <button className="mobile-navigation-toggle" aria-expanded={navigationOpen}
            aria-controls="table-navigation" onClick={() => setNavigationOpen(!navigationOpen)}>
            {navigationOpen ? 'Close tables' : 'Choose table'}
          </button>
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

        <div className="table-list" id="table-navigation">
          {filteredTables.map((item) => (
            <button
              key={item.name}
              className={table === item.name ? 'active' : ''}
              onClick={() => { selectTable(item.name); setNavigationOpen(false); }}
            >
              <span>{item.name}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="logout" onClick={logout}>Logout</button>
        </div>
      </aside>

  );
}
