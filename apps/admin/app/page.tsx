'use client';

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const RouteMap = dynamic(() => import('./route-map'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const REVERSE_GEOCODING_URL = process.env.NEXT_PUBLIC_REVERSE_GEOCODING_URL;

type User = { id: string; email: string; name: string; role: string };
type AdminAccount = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPERADMIN';
  isActive: boolean;
};
type EmployeeAccount = {
  id: string;
  email: string;
  name: string;
  role: 'EMPLOYEE';
  isActive: boolean;
  createdAt: string;
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
  segmentDistanceMeters: number;
};
type RouteLocation = { latitude: number; longitude: number; accuracy: number | null } | null;
type RouteData = {
  shiftId: string;
  points: RoutePoint[];
  distanceMeters: number;
  employee: { name: string };
  startedAt: string;
  endedAt: string | null;
  startLocation: RouteLocation;
  endLocation: RouteLocation;
  quality: {
    coverage: 'good' | 'partial' | 'limited';
    pointCount: number;
    averageAccuracyMeters: number | null;
    maxGapSeconds: number;
    significantGapCount: number;
    mockedPointCount: number;
    recordedDurationSeconds: number;
  };
};
type AuditEntry = {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetName: string;
  targetEmail: string | null;
  summary: string;
  createdAt: string;
};

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
  const [activeShifts, setActiveShifts] = useState(0);
  const [selectedRoute, setSelectedRoute] = useState<RouteData | null>(null);
  const [routeAddresses, setRouteAddresses] = useState<{ start: string; end: string } | null>(null);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState('');
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);
  const shiftRequest = useRef<AbortController | null>(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [employeePassword, setEmployeePassword] = useState('');
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [editingEmployeeId, setEditingEmployeeId] = useState('');
  const [editingEmployeeName, setEditingEmployeeName] = useState('');
  const [editingEmployeeEmail, setEditingEmployeeEmail] = useState('');
  const [editingEmployeePassword, setEditingEmployeePassword] = useState('');
  const [section, setSection] = useState<'overview' | 'attendance' | 'employees' | 'access' | 'audit' | 'settings'>('overview');
  const [shiftSearch, setShiftSearch] = useState('');
  const [shiftStatus, setShiftStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
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
    shiftRequest.current?.abort();
    const controller = new AbortController();
    shiftRequest.current = controller;
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
        status: shiftStatus,
      });
      if (shiftSearch.trim()) query.set('search', shiftSearch.trim());
      const response = await fetch(`${API_URL}/admin/shifts?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load shifts.');
      setShifts(result.shifts);
      setPage(result.page);
      setTotalShifts(result.total);
      setActiveShifts(result.activeShifts);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus(error instanceof Error ? error.message : 'Could not load shifts.');
    } finally {
      if (shiftRequest.current === controller) setLoading(false);
    }
  }

  useEffect(() => () => shiftRequest.current?.abort(), []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => void loadShifts(1), shiftSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [token, date, shiftSearch, shiftStatus]);

  useEffect(() => {
    if (token) void loadEmployees();
  }, [token]);

  useEffect(() => {
    if (token && user?.role === 'SUPERADMIN') {
      void loadAdmins();
      void loadSettings();
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (token && user?.role === 'SUPERADMIN' && section === 'audit') void loadAudit();
  }, [token, user?.role, section]);

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

  async function loadEmployees() {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/admin/employees`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load employee accounts.');
      setEmployees(result);
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'Could not load employee accounts.');
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

  async function loadAudit(requestedPage = 1) {
    if (!token || user?.role !== 'SUPERADMIN') return;
    setAuditLoading(true);
    try {
      const query = new URLSearchParams({ page: String(requestedPage), pageSize: '50' });
      const response = await fetch(`${API_URL}/admin/audit?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not load the audit log.');
      setAuditEntries(result.entries);
      setAuditPage(result.page);
      setAuditTotal(result.total);
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'Could not load the audit log.');
    } finally {
      setAuditLoading(false);
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
    setRouteAddresses(null);
    setAddressLookupError('');
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

  async function lookupRouteAddresses() {
    if (!selectedRoute) return;
    if (!REVERSE_GEOCODING_URL) {
      setAddressLookupError('Set NEXT_PUBLIC_REVERSE_GEOCODING_URL in the admin app environment to enable address lookup.');
      return;
    }
    const start = selectedRoute.startLocation ?? selectedRoute.points[0];
    const end = selectedRoute.endLocation ?? selectedRoute.points[selectedRoute.points.length - 1];
    if (!start || !end) {
      setAddressLookupError('This shift has no start or end coordinates to look up.');
      return;
    }
    setAddressLookupLoading(true);
    setAddressLookupError('');
    setRouteAddresses(null);
    try {
      const baseUrl = new URL(REVERSE_GEOCODING_URL);
      const isLocalHttp = baseUrl.protocol === 'http:' &&
        (baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1' || baseUrl.hostname === '[::1]');
      if (baseUrl.protocol !== 'https:' && !isLocalHttp) {
        throw new Error('The address lookup endpoint must use HTTPS (HTTP is allowed only for localhost).');
      }
      const lookup = async (location: { latitude: number; longitude: number }) => {
        const url = new URL(baseUrl);
        url.searchParams.set('lat', String(location.latitude));
        url.searchParams.set('lon', String(location.longitude));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Address lookup failed with HTTP ${response.status}.`);
        const result: unknown = await response.json();
        if (typeof result !== 'object' || result === null || !('display_name' in result) ||
          typeof result.display_name !== 'string' || !result.display_name.trim()) {
          throw new Error('The address lookup endpoint must return a non-empty display_name field.');
        }
        return result.display_name;
      };
      const [startAddress, endAddress] = await Promise.all([lookup(start), lookup(end)]);
      setRouteAddresses({ start: startAddress, end: endAddress });
    } catch (error) {
      setAddressLookupError(error instanceof Error ? error.message : 'Address lookup failed.');
    } finally {
      setAddressLookupLoading(false);
    }
  }

  function downloadRouteReport() {
    if (!selectedRoute) return;
    const csvValue = (value: string | number | boolean | null) =>
      `"${String(value ?? '').replaceAll('"', '""')}"`;
    const quality = selectedRoute.quality;
    const rows = [
      ['record_type', 'shift_id', 'employee', 'shift_started_at', 'shift_ended_at', 'estimated_distance_m', 'coverage', 'point_count', 'average_accuracy_m', 'max_gap_seconds', 'gaps_over_10_minutes', 'mocked_point_count', 'point_number', 'captured_at', 'latitude', 'longitude', 'accuracy_m', 'device_reported_mocked', 'segment_distance_m'],
      ['shift', selectedRoute.shiftId, selectedRoute.employee.name, selectedRoute.startedAt, selectedRoute.endedAt, Math.round(selectedRoute.distanceMeters), quality.coverage, quality.pointCount, quality.averageAccuracyMeters, quality.maxGapSeconds, quality.significantGapCount, quality.mockedPointCount, '', '', '', '', '', '', ''],
      ...selectedRoute.points.map((point, index) => [
        'gps_point', selectedRoute.shiftId, selectedRoute.employee.name, '', '', '', '', '', '', '', '', '',
        index + 1, point.capturedAt, point.latitude, point.longitude, point.accuracy, point.isMocked, Math.round(point.segmentDistanceMeters),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `route-${selectedRoute.employee.name.trim().replace(/[^a-z0-9_-]+/gi, '-')}-${selectedRoute.shiftId}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportShifts() {
    setLoading(true);
    setStatus('');
    setStatusKind('error');
    try {
      const bounds = localDayBounds(date);
      const filters = {
        ...bounds,
        page: '1',
        pageSize: '100',
        status: shiftStatus,
        ...(shiftSearch.trim() ? { search: shiftSearch.trim() } : {}),
      };
      const firstQuery = new URLSearchParams(filters);
      const firstResponse = await fetch(`${API_URL}/admin/shifts?${firstQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleUnauthorized(firstResponse);
      const firstResult = await firstResponse.json();
      if (!firstResponse.ok) throw new Error(firstResult.message ?? 'Could not export attendance.');
      if (firstResult.total > 5000) {
        throw new Error('This export exceeds 5,000 shifts. Narrow the date, status, or search and try again.');
      }

      const allShifts: Shift[] = [...firstResult.shifts];
      const totalPages = Math.ceil(firstResult.total / 100);
      for (let requestedPage = 2; requestedPage <= totalPages; requestedPage += 1) {
        const query = new URLSearchParams({ ...filters, page: String(requestedPage) });
        const response = await fetch(`${API_URL}/admin/shifts?${query}`, {
          headers: {           Authorization: `Bearer ${token}`, },
        });
        handleUnauthorized(response);
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Could not export attendance.');
        allShifts.push(...result.shifts);
      }

      const csvCell = (value: string | number) => {
        const text = String(value);
        const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safeText.replaceAll('"', '""')}"`;
      };
      const rows = [
        ['Employee name', 'Employee email', 'Check-in', 'Check-out', 'Status', 'Distance (meters)', 'GPS samples', 'Review flags'],
        ...allShifts.map((shift) => [
          shift.employee.name,
          shift.employee.email,
          shift.startedAt,
          shift.endedAt ?? '',
          shift.endedAt ? 'Completed' : 'Active',
          shift.distanceMeters,
          shift.sampleCount,
          shift.riskFlags.join('; '),
        ]),
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
      const blobUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const download = document.createElement('a');
      download.href = blobUrl;
      download.download = `attendance-${date}-${shiftStatus}.csv`;
      download.click();
      URL.revokeObjectURL(blobUrl);
      setStatusKind('success');
      setStatus(`Exported ${allShifts.length} shift${allShifts.length === 1 ? '' : 's'} to CSV.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not export attendance.');
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
      await loadEmployees();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create employee.');
    } finally {
      setLoading(false);
    }
  }

  async function updateEmployee(
    account: EmployeeAccount,
    changes: Partial<Pick<EmployeeAccount, 'isActive' | 'name' | 'email'>> & { password?: string },
  ) {
    if (changes.isActive === false && !window.confirm(
      `Disable ${account.name}'s account? They will no longer be able to sign in. Attendance history will be retained.`,
    )) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/employees/${account.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changes),
      });
      handleUnauthorized(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not update employee account.');
      setEmployees((existing) => existing.map((item) => item.id === result.id ? result : item));
      setEditingEmployeeId('');
      setEditingEmployeePassword('');
      setStatusKind('success');
      setStatus(changes.password
        ? `Updated employee details and reset the password for ${result.email}.`
        : `Updated employee account ${result.email}.`);
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'Could not update employee account.');
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

  function navigateTo(nextSection: typeof section) {
    if (nextSection !== 'attendance') {
      setShiftSearch('');
      setShiftStatus('all');
    }
    setSection(nextSection);
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
        <nav className="side-nav" aria-label="Workspace">
          <p className="nav-caption">WORKSPACE</p>
          <button type="button" aria-current={section === 'overview' ? 'page' : undefined} className={section === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('overview')}><span>⌂</span>Overview</button>
          <button type="button" aria-current={section === 'attendance' ? 'page' : undefined} className={section === 'attendance' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('attendance')}><span>◷</span>Attendance</button>
          <button type="button" aria-current={section === 'employees' ? 'page' : undefined} className={section === 'employees' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('employees')}><span>♙</span>Employees</button>
          {user.role === 'SUPERADMIN' && (
            <>
              <p className="nav-caption">PLATFORM</p>
              <button type="button" aria-current={section === 'access' ? 'page' : undefined} className={section === 'access' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('access')}><span>♙</span>Admin access</button>
              <button type="button" aria-current={section === 'audit' ? 'page' : undefined} className={section === 'audit' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('audit')}><span>▤</span>Audit log</button>
              <button type="button" aria-current={section === 'settings' ? 'page' : undefined} className={section === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo('settings')}><span>⚙</span>System settings</button>
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
            <p className="eyebrow">{section === 'overview' || section === 'attendance' || section === 'employees' ? 'WORKFORCE OPERATIONS' : 'PLATFORM CONTROL'}</p>
            <h1>{section === 'overview' ? 'Overview' : section === 'attendance' ? 'Attendance' : section === 'employees' ? 'Employees' : section === 'access' ? 'Admin access' : section === 'audit' ? 'Audit log' : 'System settings'}</h1>
            <p className="muted">
              {section === 'overview'
                ? 'Your workforce at a glance. Choose a section from the sidebar to get started.'
                : section === 'attendance'
                  ? 'Review shifts and recorded routes for the selected workday.'
                : section === 'employees'
                  ? 'Register employees, update their account details, reset passwords, and manage sign-in access.'
                : section === 'access'
                  ? 'Control who has administrator and superadmin access.'
                  : section === 'audit'
                    ? 'Review account and system changes made by administrators.'
                  : 'Manage organization-wide location data retention.'}
            </p>
          </div>
          {(section === 'overview' || section === 'attendance') && <div className="date-filter">
            <label htmlFor="day-filter">Workday</label>
            <input id="day-filter" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button className="primary" onClick={() => void loadShifts(1)} disabled={loading}>Refresh</button>
          </div>}
        </div>

        {status && <div className={`notice ${statusKind}`}>{status}</div>}
        {section === 'overview' && <>
          <div className="stats">
            <div className="stat-card"><span>Shifts started</span><strong>{totalShifts}</strong><small>on selected workday</small></div>
            <div className="stat-card"><span>Active shifts</span><strong>{activeShifts}</strong><small>not checked out yet</small></div>
            <div className="stat-card"><span>Active employees</span><strong>{employees.filter((employee) => employee.isActive).length}</strong><small>enabled employee accounts</small></div>
          </div>
          <div className="quick-links">
            <button type="button" className="quick-link-card" onClick={() => navigateTo('attendance')}>
              <span className="quick-link-icon">◷</span>
              <span><strong>Review attendance</strong><small>Browse daily shifts and recorded routes</small></span>
              <span className="quick-link-arrow">→</span>
            </button>
            <button type="button" className="quick-link-card" onClick={() => navigateTo('employees')}>
              <span className="quick-link-icon">♙</span>
              <span><strong>Manage employees</strong><small>{employees.length} registered · {employees.filter((employee) => employee.isActive).length} active</small></span>
              <span className="quick-link-arrow">→</span>
            </button>
            {user.role === 'SUPERADMIN' && <button type="button" className="quick-link-card" onClick={() => navigateTo('access')}>
              <span className="quick-link-icon">⚙</span>
              <span><strong>Admin access</strong><small>Manage administrator accounts and roles</small></span>
              <span className="quick-link-arrow">→</span>
            </button>}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div><h2>Recent shifts</h2><p className="muted">Latest activity on the selected workday.</p></div>
              <button type="button" className="secondary" onClick={() => navigateTo('attendance')}>View all attendance</button>
            </div>
            {shifts.length === 0 ? (
              <div className="empty">{loading ? 'Loading attendance…' : 'No shifts found for this workday.'}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Check-in</th><th>Status</th></tr></thead>
                  <tbody>{shifts.slice(0, 5).map((shift) => (
                    <tr key={shift.id}>
                      <td><strong>{shift.employee.name}</strong><small>{shift.employee.email}</small></td>
                      <td>{new Date(shift.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{shift.endedAt ? 'Completed' : <span className="badge">Active</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>}

        {section === 'employees' && <section className="panel employee-panel">
          <div className="panel-heading">
            <div><h2>Employee accounts</h2><p className="muted">Register, update, and manage employee sign-in access. Attendance history is retained when an account is disabled.</p></div>
            <div className="employee-actions">
              <button className="secondary" onClick={() => void loadEmployees()} disabled={loading}>Refresh list</button>
              <button className="primary" onClick={() => setShowEmployeeForm((visible) => !visible)}>{showEmployeeForm ? 'Cancel' : 'Register employee'}</button>
            </div>
          </div>
          {showEmployeeForm && (
            <form className="employee-form" onSubmit={(event) => void createEmployee(event)}>
              <label>Full name<input required value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} /></label>
              <label>Work email<input required type="email" value={employeeEmail} onChange={(event) => setEmployeeEmail(event.target.value)} /></label>
              <label>Temporary password<input required minLength={12} type="password" autoComplete="new-password" value={employeePassword} onChange={(event) => setEmployeePassword(event.target.value)} /></label>
              <button className="primary" disabled={loading}>{loading ? 'Registering…' : 'Register employee'}</button>
            </form>
          )}
          <div className="employee-directory-heading">
            <strong>{employees.length} registered · {employees.filter((employee) => employee.isActive).length} active</strong>
            <input
              aria-label="Search employees"
              type="search"
              placeholder="Search by name or email"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Registered</th><th>Status</th><th>Account actions</th></tr></thead>
              <tbody>
                {employees.filter((employee) => {
                  const query = employeeSearch.trim().toLowerCase();
                  return !query || employee.name.toLowerCase().includes(query) || employee.email.toLowerCase().includes(query);
                }).map((employee) => (
                  <Fragment key={employee.id}>
                    <tr>
                      <td><strong>{employee.name}</strong><small>{employee.email}</small></td>
                      <td>{new Date(employee.createdAt).toLocaleDateString()}</td>
                      <td><span className={employee.isActive ? 'badge' : 'status-off'}>{employee.isActive ? 'Active' : 'Disabled'}</span></td>
                      <td className="access-controls">
                        <button className="text-button" onClick={() => {
                          setEditingEmployeeId(editingEmployeeId === employee.id ? '' : employee.id);
                          setEditingEmployeeName(employee.name);
                          setEditingEmployeeEmail(employee.email);
                          setEditingEmployeePassword('');
                        }}>
                          {editingEmployeeId === employee.id ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          className="text-button"
                          disabled={loading}
                          onClick={() => void updateEmployee(employee, { isActive: !employee.isActive })}
                        >
                          {employee.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                    {editingEmployeeId === employee.id && (
                      <tr>
                        <td colSpan={4}>
                          <form
                            className="employee-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void updateEmployee(employee, {
                                name: editingEmployeeName,
                                email: editingEmployeeEmail,
                                ...(editingEmployeePassword ? { password: editingEmployeePassword } : {}),
                              });
                            }}
                          >
                            <label>Full name<input required value={editingEmployeeName} onChange={(event) => setEditingEmployeeName(event.target.value)} /></label>
                            <label>Work email<input required type="email" value={editingEmployeeEmail} onChange={(event) => setEditingEmployeeEmail(event.target.value)} /></label>
                            <label>Reset password (leave blank to keep current)<input minLength={12} type="password" autoComplete="new-password" value={editingEmployeePassword} onChange={(event) => setEditingEmployeePassword(event.target.value)} /></label>
                            <button className="primary" disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {employees.length === 0 && <tr><td className="empty" colSpan={4}>No employee accounts yet. Select “Register employee” to add the first one.</td></tr>}
                {employees.length > 0 && !employees.some((employee) => {
                  const query = employeeSearch.trim().toLowerCase();
                  return !query || employee.name.toLowerCase().includes(query) || employee.email.toLowerCase().includes(query);
                }) && <tr><td className="empty" colSpan={4}>No employees match your search.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>}
        {section === 'attendance' && <>
          <div className="stats">
            <div className="stat-card"><span>Shifts started</span><strong>{totalShifts}</strong><small>on selected workday</small></div>
            <div className="stat-card"><span>Active shifts</span><strong>{activeShifts}</strong><small>not checked out yet</small></div>
            <div className="stat-card"><span>Recorded distance</span><strong>{(totalDistance / 1000).toFixed(1)} km</strong><small>estimate on current page</small></div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div><h2>Employee shifts</h2><p className="muted">Search across employees and filter by shift status.</p></div>
              {loading && <span className="muted" role="status">Loading…</span>}
            </div>
            <div className="shift-toolbar">
              <input
                type="search"
                placeholder="Search employee name or email"
                aria-label="Search shifts by employee"
                value={shiftSearch}
                onChange={(event) => setShiftSearch(event.target.value)}
              />
              <label>
                Shift status
                <select value={shiftStatus} onChange={(event) => setShiftStatus(event.target.value as typeof shiftStatus)}>
                  <option value="all">All shifts</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <button type="button" className="secondary" onClick={() => void exportShifts()} disabled={loading || totalShifts === 0}>
                {loading ? 'Working…' : 'Export CSV'}
              </button>
            </div>
            {shifts.length === 0 ? (
              <div className="empty">
                {loading ? 'Loading attendance…' : totalShifts === 0
                  ? 'No shifts match this date and filter. Try another date or clear the search.'
                  : 'No shifts to show on this page.'}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Distance</th><th>Samples</th><th>Review</th></tr></thead>
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
                          <button type="button" className="text-button" onClick={() => void loadRoute(shift.id)} disabled={loading}>View route</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalShifts > 50 && (
              <div className="pagination">
                <span className="muted">Page {page} of {Math.ceil(totalShifts / 50)} · {totalShifts} matching shifts</span>
                <div>
                  <button type="button" className="text-button" disabled={loading || page <= 1} onClick={() => void loadShifts(page - 1)}>Previous</button>
                  <button type="button" className="text-button" disabled={loading || page * 50 >= totalShifts} onClick={() => void loadShifts(page + 1)}>Next</button>
                </div>
              </div>
            )}
          </section>
        </>}

        {section === 'attendance' && selectedRoute && (
          <section className="panel route-panel">
            <div className="panel-heading">
              <div><h2>{selectedRoute.employee.name} · route details</h2><p className="muted">{selectedRoute.points.length} recorded GPS points · {(selectedRoute.distanceMeters / 1000).toFixed(2)} km estimated</p></div>
              <div className="route-actions">
                <button className="secondary" onClick={downloadRouteReport}>Download route CSV</button>
                <button className="text-button" onClick={() => {
                  setSelectedRoute(null);
                  setRouteAddresses(null);
                  setAddressLookupError('');
                }}>Close</button>
              </div>
            </div>
            <div className="route-quality">
              <span className={`coverage-badge ${selectedRoute.quality.coverage}`}>{selectedRoute.quality.coverage} coverage</span>
              <span>{selectedRoute.quality.pointCount} GPS points</span>
              <span>Average accuracy {selectedRoute.quality.averageAccuracyMeters === null ? 'unavailable' : `±${selectedRoute.quality.averageAccuracyMeters} m`}</span>
              <span>Longest gap {Math.floor(selectedRoute.quality.maxGapSeconds / 60)} min</span>
              <span>{selectedRoute.quality.significantGapCount} gaps over 10 min</span>
              <span>{selectedRoute.quality.mockedPointCount} device-reported mock flags</span>
            </div>
            <p className="route-disclaimer">
              Coverage is a heuristic: limited means fewer than 2 points, a gap over 30 minutes, or average accuracy worse than 70 m; partial means a gap over 10 minutes or average accuracy worse than 35 m. It is not proof of a complete journey. Distance is a straight-line GPS estimate, not road distance.
            </p>
            <div className="route-locations">
              <div><strong>Start</strong><span>{routeAddresses?.start ?? (selectedRoute.startLocation ? `${selectedRoute.startLocation.latitude.toFixed(6)}, ${selectedRoute.startLocation.longitude.toFixed(6)}` : selectedRoute.points[0] ? `${selectedRoute.points[0].latitude.toFixed(6)}, ${selectedRoute.points[0].longitude.toFixed(6)}` : 'Unavailable')}</span></div>
              <div><strong>End</strong><span>{routeAddresses?.end ?? (selectedRoute.endLocation ? `${selectedRoute.endLocation.latitude.toFixed(6)}, ${selectedRoute.endLocation.longitude.toFixed(6)}` : selectedRoute.points.length > 0 ? `${selectedRoute.points[selectedRoute.points.length - 1].latitude.toFixed(6)}, ${selectedRoute.points[selectedRoute.points.length - 1].longitude.toFixed(6)}` : 'Unavailable')}</span></div>
              <button className="secondary" onClick={() => void lookupRouteAddresses()} disabled={addressLookupLoading}>
                {addressLookupLoading ? 'Looking up…' : 'Look up start/end addresses'}
              </button>
            </div>
            {addressLookupError && <p className="address-error" role="alert">{addressLookupError}</p>}
            <p className="geocoder-privacy">Address lookup is optional. Clicking the button sends the start and end coordinates to the configured endpoint.</p>
            {(selectedRoute.points.length > 0 || selectedRoute.startLocation || selectedRoute.endLocation) && (
              <>
                <RouteMap
                  points={selectedRoute.points}
                  startLocation={selectedRoute.startLocation}
                  endLocation={selectedRoute.endLocation}
                />
                <div className="route-map-legend"><span>● GPS point</span><span className="start-marker">● Check-in</span><span className="end-marker">● Check-out</span><small>Map tiles © OpenStreetMap contributors</small></div>
              </>
            )}
            <div className="route-list">
              {selectedRoute.points.map((point, index) => (
                <div className="route-point" key={`${point.capturedAt}-${index}`}>
                  <span className="point-index" title={`Approx. ${Math.round(point.segmentDistanceMeters)} m since prior point`}>{index + 1}</span>
                  <div><strong>{new Date(point.capturedAt).toLocaleTimeString()}{point.isMocked ? ' · device reported mock location' : ''}</strong><small>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</small></div>
                  <span className="muted">±{Math.round(point.accuracy)} m</span>
                  <span className="muted">{Math.round(point.segmentDistanceMeters)} m</span>
                </div>
              ))}
              {selectedRoute.points.length === 0 && <div className="empty">No GPS points recorded for this shift.</div>}
            </div>
          </section>
        )}
        {section === 'attendance' && <p className="privacy-note">Location is recorded only for active shifts. GPS readings may be inaccurate and route distance is an estimate. Mock-location flags are device-reported signals, not proof.</p>}

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

        {section === 'audit' && user.role === 'SUPERADMIN' && (
          <section className="panel">
            <div className="panel-heading">
              <div><h2>Administrator activity</h2><p className="muted">Passwords and secrets are never included in this log.</p></div>
              <button type="button" className="secondary" onClick={() => void loadAudit(auditPage)} disabled={auditLoading}>
                {auditLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {auditLoading && auditEntries.length === 0 ? (
              <div className="empty" role="status">Loading audit history…</div>
            ) : auditEntries.length === 0 ? (
              <div className="empty">No administrative changes have been recorded yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="audit-table">
                  <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Account / setting</th><th>Details</th></tr></thead>
                  <tbody>{auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td><strong>{entry.actorName}</strong><small>{entry.actorEmail}</small></td>
                      <td><span className="role-pill">{entry.action.replaceAll('_', ' ')}</span></td>
                      <td><strong>{entry.targetName}</strong>{entry.targetEmail && <small>{entry.targetEmail}</small>}</td>
                      <td>{entry.summary}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {auditTotal > 50 && (
              <div className="pagination">
                <span className="muted">Page {auditPage} of {Math.ceil(auditTotal / 50)} · {auditTotal} events</span>
                <div>
                  <button type="button" className="text-button" disabled={auditLoading || auditPage <= 1} onClick={() => void loadAudit(auditPage - 1)}>Previous</button>
                  <button type="button" className="text-button" disabled={auditLoading || auditPage * 50 >= auditTotal} onClick={() => void loadAudit(auditPage + 1)}>Next</button>
                </div>
              </div>
            )}
          </section>
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
