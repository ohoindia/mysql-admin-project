import { lazy, Suspense, useState } from 'react';
import Login from './components/Login';
import TableSidebar from './components/TableSidebar';
import TableBrowser from './components/TableBrowser';
import RecordModal from './components/RecordModal';
import useSession from './hooks/useSession';
import useTables from './hooks/useTables';
import useTableBrowser from './hooks/useTableBrowser';

const QueryConsole = lazy(() => import('./components/QueryConsole'));

function Workspace({ session, logout }) {
  const [view, setView] = useState('tables');
  const [queryOpened, setQueryOpened] = useState(false);
  const { tables, error, refresh } = useTables();
  const browser = useTableBrowser();
  const superUser = session.isSuperUser === true;
  return <div className="app">
    <TableSidebar user={session.username} tables={tables} table={browser.table} logout={logout}
      selectTable={name => { setView('tables'); browser.selectTable(name); }} />
    <main className="main-content">
      <nav className="query-actions" aria-label="Workspace">
        <button className={view === 'tables' ? 'primary' : 'refresh-btn'} aria-pressed={view === 'tables'}
          onClick={() => { setView('tables'); refresh(); if (browser.table) browser.load(browser.table); }}>Table browser</button>
        <button className={view === 'query' ? 'primary' : 'refresh-btn'} aria-pressed={view === 'query'}
          onClick={() => { setQueryOpened(true); setView('query'); }}>SQL Console</button>
      </nav>
      {error && <div className="error-msg" role="alert">{error}</div>}
      {queryOpened && <div className="query-workspace" hidden={view !== 'query'}>
        <h1>SQL Console</h1>
        <Suspense fallback={<p role="status">Loading SQL Console...</p>}>
          <QueryConsole allowed={session.canRunQueries === true} superUser={superUser} />
        </Suspense>
      </div>}
      {view === 'tables' && <TableBrowser browser={browser} superUser={superUser} />}
    </main>
    <RecordModal browser={browser} superUser={superUser} />
  </div>;
}

export default function App() {
  const { session, checking, signIn, logout } = useSession();
  if (checking) return <div className="center-page" role="status">Loading...</div>;
  if (!session) return <Login onLogin={signIn} />;
  return <Workspace key={session.username} session={session} logout={logout} />;
}
