'use client';

import { Fragment, FormEvent, useEffect, useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type User = { id: string; email: string; name: string; role: string };
type AdminAccount = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPERADMIN';
  isActive: boolean;
};
type Shift = {
  id: string;
  employee: { id: string; name: string; email: string };
  startedAt: string;
  endedAt: string | null;
  checkIn: { latitude: number | null; longitude: number | null; accuracy: number | null; isMocked: boolean };
  checkOut: { latitude: number; longitude: number; accuracy: number; isMocked: boolean | null } | null;
  distanceMeters: number;
  sampleCount: number;
  riskFlags: string[];
};
type RoutePoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  isMocked: boolean;
};
type RouteData = { points: RoutePoint[]; distanceMeters: number; employee: { name: string } };

function localDayBounds(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [page, setPage] = useState(1);
  const [totalShifts, setTotalShifts] = useState(0);
  const [selectedRoute, setSelectedRoute] = useState<RouteData | null>(null);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [employeePassword, setEmployeePassword] = useState('');
  const [section, setSection] = useState<'overview' | 'access' | 'settings'>('overview');
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [editingAdminId, setEditingAdminId] = useState('');
  const [editingAdminName, setEditingAdminName] = useState('');
  const [editingAdminEmail, setEditingAdminEmail] = useState('');
  const [editingAdminPassword, setEditingAdminPassword] = useState('');
  const [retentionDays, setRetentionDays] = useState('90');

  useEffect(() => {
    const savedToken = window.localStorage.getItem('attendance_admin_token');
    const savedUser = window.localStorage.getItem('attendance_admin_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser) as User);
    }
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');
    setStatusKind('error');
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Sign-in failed.');
      if (result.user.role !== 'ADMIN' && result.user.role !== 'SUPERADMIN') {
        throw new Error('This account does not have administrator access.');
      }
      setToken(result.accessToken);
      setUser(result.user);
      window.localStorage.setItem('attendance_admin_token', result.accessToken);
      window.localStorage.setItem('attendance_admin_user', JSON.stringify(result.user));
      setPassword('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function loadShifts(requestedPage = 1) {
    if (!token) return;
    setStatus('');
    setStatusKind('error');
    setLoading(true);
    setSelectedRoute(null);
    try {
      const bounds = localDayBounds(date);
      const query = new URLSearchParams({
        ...bounds,
        page: String(requestedPage),
        pageSize: '50',
      });
      const response = await fetch(`${API_URL}/admin/shifts?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load shifts.');
      setShifts(result.shifts);
      setPage(result.page);
      setTotalShifts(result.total);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load shifts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void loadShifts(1);
  }, [token, date]);

  useEffect(() => {
    if (token && user?.role === 'SUPERADMIN') {
      void loadAdmins();
      void loadSettings();
    }
  }, [token, user?.role]);

  async function loadAdmins() {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/admin/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load administrators.');
      setAdmins(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load administrators.');
    }
  }

  async function loadSettings() {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/admin/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load system settings.');
      setRetentionDays(String(result.locationRetentionDays));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load system settings.');
    }
  }

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/admins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: adminName, email: adminEmail, password: adminPassword }),
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not create administrator.');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      setStatusKind('success');
      setStatus(`Administrator account created for ${result.email}. Share the initial password securely.`);
      await loadAdmins();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create administrator.');
    } finally {
      setLoading(false);
    }
  }

  async function updateAdmin(
    account: AdminAccount,
    changes: Partial<Pick<AdminAccount, 'role' | 'isActive' | 'name' | 'email'>> & { password?: string },
  ) {
    const updated = { ...account, ...changes };
    try {
      const response = await fetch(`${API_URL}/admin/admins/${account.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: updated.role,
          isActive: updated.isActive,
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.email !== undefined ? { email: changes.email } : {}),
          ...(changes.password ? { password: changes.password } : {}),
        }),
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not update administrator.');
      setAdmins((existing) => existing.map((item) => item.id === result.id ? result : item));
      if (user && result.id === user.id) {
        const updatedUser = { ...user, name: result.name, email: result.email, role: result.role };
        setUser(updatedUser);
        window.localStorage.setItem('attendance_admin_user', JSON.stringify(updatedUser));
      }
      if (editingAdminId === account.id) {
        setEditingAdminId('');
        setEditingAdminPassword('');
      }
      setStatusKind('success');
      setStatus(changes.password
        ? `Updated administrator details and reset the password for ${result.email}.`
        : `Updated administrator account ${result.email}.`);
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'Could not update administrator.');
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ locationRetentionDays: Number(retentionDays) }),
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not save system settings.');
      setRetentionDays(String(result.locationRetentionDays));
      setStatusKind('success');
      setStatus('System settings saved. The new retention period will be used by the next cleanup run.');
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'Could not save system settings.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRoute(shiftId: string) {
    setStatus('');
    setStatusKind('error');
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/admin/shifts/route?${new URLSearchParams({ shiftId })}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load route.');
      setSelectedRoute(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load route.');
    } finally {
      setLoading(false);
    }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: employeeName,
          email: employeeEmail,
          password: employeePassword,
        }),
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not create employee.');
      setEmployeeName('');
      setEmployeeEmail('');
      setEmployeePassword('');
      setShowEmployeeForm(false);
      setStatusKind('success');
      setStatus(`Employee account created for ${result.email}. Share the initial password securely.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create employee.');
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    window.localStorage.removeItem('attendance_admin_token');
    window.localStorage.removeItem('attendance_admin_user');
    setToken('');
    setUser(null);
    setShifts([]);
    setSelectedRoute(null);
  }

  function handleUnauthorized(response: Response) {
    if (response.status !== 401 && response.status !== 403) return;
    window.localStorage.removeItem('attendance_admin_token');
    window.localStorage.removeItem('attendance_admin_user');
    setToken('');
    setUser(null);
    setShifts([]);
    setSelectedRoute(null);
    throw new Error(response.status === 401
      ? 'Your session expired. Sign in again.'
      : 'Your access changed. Sign in again.');
  }

  const totalDistance = useMemo(
    () => shifts.reduce((total, shift) => total + shift.distanceMeters, 0),
    [shifts],
  );

  if (!user) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={login}>
          <div className="brand-mark">A</div>
          <p className="eyebrow">WORKFORCE OPERATIONS</p>
          <h1>Attendance dashboard</h1>
          <p className="muted">Sign in to review attendance and on-shift location data.</p>
          <label>
            Work email
            <input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {status && <p className="error">{status}</p>}
          <button className="primary full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </main>
    );
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">A</div>
          <div><strong>Attendance</strong><small>WORKFORCE SUITE</small></div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="side-nav" aria-label="Workspace">
          <button className={section === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('overview')}><span>◷</span>Attendance</button>
          {user.role === 'SUPERADMIN' && (
            <>
              <p className="nav-caption">PLATFORM</p>
              <button className={section === 'access' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('access')}><span>♙</span>Admin access</button>
              <button className={section === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('settings')}><span>⚙</span>System settings</button>
            </>
          )}
        </nav>
        <div className="sidebar-foot"><span className="online-dot" /> API-connected workspace</div>
      </aside>
      <main className="dashboard">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark small">A</div>
          <span>Attendance</span>
          <span className="divider">/</span>
          <span className="role-pill">{user.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN'}</span>
        </div>
        <div className="account">
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div><strong>{user.name}</strong><small>{user.email}</small></div>
          <button className="text-button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <section className="content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{section === 'overview' ? 'WORKFORCE OPERATIONS' : 'PLATFORM CONTROL'}</p>
            <h1>{section === 'overview' ? 'Attendance overview' : section === 'access' ? 'Admin access' : 'System settings'}</h1>
            <p className="muted">
              {section === 'overview'
                ? 'A clear view of today’s attendance and active workforce.'
                : section === 'access'
                  ? 'Control who has administrator and superadmin access.'
                  : 'Manage organization-wide location data retention.'}
            </p>
          </div>
          {section === 'overview' && <div className="date-filter">
            <label htmlFor="day-filter">Workday</label>
            <input id="day-filter" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button className="primary" onClick={() => void loadShifts(1)} disabled={loading}>Refresh</button>
          </div>}
        </div>

        {status && <div className={`notice ${statusKind}`}>{status}</div>}
        {section === 'overview' && <div className="stats">
          <div className="stat-card"><span>Shifts started</span><strong>{totalShifts}</strong><small>on selected local day</small></div>
          <div className="stat-card"><span>Active shifts (page)</span><strong>{shifts.filter((shift) => !shift.endedAt).length}</strong><small>on this page only</small></div>
          <div className="stat-card"><span>Recorded distance (page)</span><strong>{(totalDistance / 1000).toFixed(1)} km</strong><small>route estimate on this page</small></div>
        </div>}

        {section === 'overview' && <section className="panel employee-panel">
          <div className="panel-heading">
            <div><h2>Employee accounts</h2><p className="muted">Create an account to invite an employee to the app.</p></div>
            <button className="primary" onClick={() => setShowEmployeeForm((visible) => !visible)}>Add employee</button>
          </div>
          {showEmployeeForm && (
            <form className="employee-form" onSubmit={(event) => void createEmployee(event)}>
              <label>Full name<input required value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} /></label>
              <label>Work email<input required type="email" value={employeeEmail} onChange={(event) => setEmployeeEmail(event.target.value)} /></label>
              <label>Temporary password<input required minLength={12} type="password" value={employeePassword} onChange={(event) => setEmployeePassword(event.target.value)} /></label>
              <button className="primary" disabled={loading}>Create account</button>
            </form>
          )}
        </section>}
        {section === 'overview' && <section className="panel">
          <div className="panel-heading">
            <div><h2>Employee shifts</h2><p className="muted">Distances are estimates from recorded GPS samples.</p></div>
            {loading && <span className="muted">Loading…</span>}
          </div>
          {shifts.length === 0 ? (
            <div className="empty">No shifts found for this day.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Distance</th><th>Samples</th><th></th></tr></thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={shift.id}>
                      <td><strong>{shift.employee.name}</strong><small>{shift.employee.email}</small></td>
                      <td>{new Date(shift.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{shift.endedAt ? new Date(shift.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="badge">Active</span>}</td>
                      <td>{(shift.distanceMeters / 1000).toFixed(2)} km</td>
                      <td>{shift.sampleCount}</td>
                      <td>
                        {shift.riskFlags.length > 0 && <span className="risk-badge" title={shift.riskFlags.join('; ')}>Review GPS</span>}
                        <button className="text-button" onClick={() => void loadRoute(shift.id)}>View route</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalShifts > 50 && (
            <div className="pagination">
              <span className="muted">Page {page} of {Math.ceil(totalShifts / 50)} · {totalShifts} shifts</span>
              <div>
                <button className="text-button" disabled={loading || page <= 1} onClick={() => void loadShifts(page - 1)}>Previous</button>
                <button className="text-button" disabled={loading || page * 50 >= totalShifts} onClick={() => void loadShifts(page + 1)}>Next</button>
              </div>
            </div>
          )}
        </section>}

        {section === 'overview' && selectedRoute && (
          <section className="panel route-panel">
            <div className="panel-heading">
              <div><h2>{selectedRoute.employee.name} · route details</h2><p className="muted">{selectedRoute.points.length} recorded GPS points · {(selectedRoute.distanceMeters / 1000).toFixed(2)} km estimated</p></div>
              <button className="text-button" onClick={() => setSelectedRoute(null)}>Close</button>
            </div>
            <div className="route-list">
              {selectedRoute.points.map((point, index) => (
                <div className="route-point" key={`${point.capturedAt}-${index}`}>
                  <span className="point-index">{index + 1}</span>
                  <div><strong>{new Date(point.capturedAt).toLocaleTimeString()}{point.isMocked ? ' · device reported mock location' : ''}</strong><small>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</small></div>
                  <span className="muted">±{Math.round(point.accuracy)} m</span>
                  <span className="muted">GPS</span>
                </div>
              ))}
              {selectedRoute.points.length === 0 && <div className="empty">No GPS points recorded for this shift.</div>}
            </div>
          </section>
        )}
        {section === 'overview' && <p className="privacy-note">Location is recorded only for active shifts. GPS readings may be inaccurate and route distance is an estimate. Mock-location flags are device-reported signals, not proof.</p>}

        {section === 'access' && user.role === 'SUPERADMIN' && (
          <>
            <section className="panel">
              <div className="panel-heading">
                <div><h2>Invite an administrator</h2><p className="muted">New accounts start with limited admin access. You can promote them to superadmin below.</p></div>
              </div>
              <form className="employee-form" onSubmit={(event) => void createAdmin(event)}>
                <label>Full name<input required value={adminName} onChange={(event) => setAdminName(event.target.value)} /></label>
                <label>Work email<input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} /></label>
                <label>Temporary password<input required minLength={12} type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></label>
                <button className="primary" disabled={loading}>Create admin</button>
              </form>
            </section>
            <section className="panel">
              <div className="panel-heading"><div><h2>Administrator accounts</h2><p className="muted">Only active superadmins can change administrator access.</p></div><button className="secondary" onClick={() => void loadAdmins()}>Refresh</button></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Administrator</th><th>Access level</th><th>Status</th><th>Control</th></tr></thead>
                  <tbody>{admins.map((account) => (
                    <Fragment key={account.id}>
                      <tr>
                        <td><strong>{account.name}</strong><small>{account.email}</small></td>
                        <td><span className={account.role === 'SUPERADMIN' ? 'role-pill super' : 'role-pill'}>{account.role}</span></td>
                        <td><span className={account.isActive ? 'badge' : 'status-off'}>{account.isActive ? 'Active' : 'Disabled'}</span></td>
                        <td className="access-controls">
                          <select
                            aria-label={`Role for ${account.email}`}
                            value={account.role}
                            disabled={account.id === user.id}
                            onChange={(event) => void updateAdmin(account, { role: event.target.value as AdminAccount['role'] })}
                          >
                            <option value="ADMIN">Admin</option>
                            <option value="SUPERADMIN">Superadmin</option>
                          </select>
                          <button className="text-button" disabled={account.id === user.id} onClick={() => void updateAdmin(account, { isActive: !account.isActive })}>
                            {account.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setEditingAdminId(editingAdminId === account.id ? '' : account.id);
                              setEditingAdminName(account.name);
                              setEditingAdminEmail(account.email);
                              setEditingAdminPassword('');
                            }}
                          >
                            {editingAdminId === account.id ? 'Cancel' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                      {editingAdminId === account.id && (
                        <tr>
                          <td colSpan={4}>
                            <form
                              className="employee-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void updateAdmin(account, {
                                  name: editingAdminName,
                                  email: editingAdminEmail,
                                  ...(editingAdminPassword ? { password: editingAdminPassword } : {}),
                                });
                              }}
                            >
                              <label>Full name<input required value={editingAdminName} onChange={(event) => setEditingAdminName(event.target.value)} /></label>
                              <label>Work email<input required type="email" value={editingAdminEmail} onChange={(event) => setEditingAdminEmail(event.target.value)} /></label>
                              <label>Reset password (leave blank to keep current)<input minLength={12} type="password" autoComplete="new-password" value={editingAdminPassword} onChange={(event) => setEditingAdminPassword(event.target.value)} /></label>
                              <button className="primary" disabled={loading}>Save changes</button>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {section === 'settings' && user.role === 'SUPERADMIN' && (
          <section className="panel settings-panel">
            <div className="settings-icon">⌁</div>
            <h2>Location retention</h2>
            <p className="muted">Choose how many days detailed GPS records are retained. Precise check-in/out coordinates are cleared for closed shifts at the same age; attendance timestamps and saved estimated distances remain.</p>
            <form onSubmit={(event) => void saveSettings(event)}>
              <label htmlFor="retention-days">Retention period <span className="muted">(1–3650 days)</span></label>
              <div className="settings-control">
                <input id="retention-days" type="number" min="1" max="3650" required value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} />
                <span>days</span>
                <button className="primary" disabled={loading}>Save settings</button>
              </div>
            </form>
            <div className="settings-note"><strong>Privacy note</strong><span>Historical route points are deleted by the cleanup job and cannot be restored.</span></div>
          </section>
        )}
      </section>
      </main>
    </div>
  );
}
