'use client';
import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthContext';
import { 
  approvePlace, 
  listAuditLogs, 
  listUserRoles, 
  rejectPlace, 
  upsertUserRole,
  addUser,
  updateUserRole,
  disableUser,
  deleteUser,
  listUsers,
  type LocalUser,
} from '@/services/adminService';
import { deletePlace, listApprovedPlaces, listStagingPlaces, listRejectedPlaces, listDuplicateSuggestions, saveStagingPlace, type PlaceRecord } from '@/services/placesService';
import { importPlaces } from '@/services/importService';

async function getRoleFromServer(token: string) {
  if (!token) {
    return { role: null, email: '', user_id: '', error: 'Missing AuthContext session token' };
  }

  const response = await fetch('/api/admin/me', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      role: null,
      email: payload.email || '',
      user_id: payload.user_id || '',
      error: payload.error || 'Admin role check failed',
    };
  }

  return {
    role: payload.role || null,
    email: payload.email || '',
    user_id: payload.user_id || '',
    error: '',
  };
}

/** Compact profile chip — top-right of main area */
function AdminProfileChip({ auth, role, isLocalMode }: { auth: any; role: string | null; isLocalMode: boolean }) {
  const displayName = auth.email?.split('@')[0] || 'Admin';
  const email = auth.email || 'local@admin';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
      <div className="gs-admin-profile-chip">
        <div className="gs-admin-profile-chip-avatar">👤</div>
        <div className="gs-admin-profile-chip-name">{displayName}</div>
        <span className="gs-admin-profile-chip-role">{isLocalMode ? 'Local' : role || '—'}</span>
        <button className="gs-admin-profile-chip-signout" onClick={async () => {
          try { if (auth.signOut) await auth.signOut(); } catch {}
        }}>Sign Out</button>
      </div>
    </div>
  );
}

const ROWS_PER_PAGE = 10;

const FILTER_OPTIONS = ['all', 'restaurant', 'hotel', 'attraction'] as const;
type FilterValue = (typeof FILTER_OPTIONS)[number];

export default function AdminTab({ onEdit }: { onEdit: (place: PlaceRecord) => void }) {
  const auth = useAuth();
  const [role, setRole] = useState<string | null>('checking');
const [authUserId, setAuthUserId] = useState<string>('');
const [authEmail, setAuthEmail] = useState<string>('');
  const [staging, setStaging] = useState<PlaceRecord[]>([]);
  const [approved, setApproved] = useState<PlaceRecord[]>([]);
  const [rejected, setRejected] = useState<PlaceRecord[]>([]);
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [roles, setRoles] = useState<LocalUser[]>([]);
  const [message, setMessage] = useState('');
  const [selectedStagingIds, setSelectedStagingIds] = useState<Set<string>>(new Set());
  const [busyUserId, setBusyUserId] = useState<string>('');
  const [draftRoles, setDraftRoles] = useState<Record<string, string>>({});
  const setBusyMessage = (text: string) => setMessage(text);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [importText, setImportText] = useState('');
  const [newRole, setNewRole] = useState<'admin'|'editor'|'viewer'>('viewer');
  const [aiProvider, setAiProvider] = useState('jarvis-gpt4o');
  
  // User management form
  const [addUserDisplayName, setAddUserDisplayName] = useState('');
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addUserPassword, setAddUserPassword] = useState('');
  const [addUserRole, setAddUserRole] = useState<'admin'|'editor'|'viewer'>('viewer');
  const isLocalMode = !isSupabaseConfigured;

  // UI-only navigation state
  const [activeSection, setActiveSection] = useState<string>('pending');

  // UI-only filter + pagination state (V4)
  const [filterCategory, setFilterCategory] = useState<FilterValue>('all');
  const [page, setPage] = useState(1);

  const load = async () => {
  try {
    if (isLocalMode) {
      setRole('admin');
    } else {
      if (auth.loading) return;

      const token = auth.session?.access_token || '';

      console.log('AUTH_DEBUG_ADMIN_TAB', {
        auth_loading: auth.loading,
        auth_email: auth.email,
        auth_user_id: auth.user?.id || '',
        has_session: Boolean(auth.session),
        token_length: token.length,
        session_user_id: auth.session?.user?.id || '',
        session_email: auth.session?.user?.email || '',
      });

      console.log('AUTH_TOKEN_LENGTH', token.length);
      setAuthUserId(auth.user?.id || '');
      setAuthEmail(auth.email || '');

      if (!token) {
        setRole(null);
        setMessage('Missing AuthContext session token');
        return;
      }

      const roleResult = await getRoleFromServer(token);
      setAuthUserId(roleResult.user_id || auth.user?.id || '');
      setAuthEmail(roleResult.email || auth.email || '');

      if (!roleResult.role) {
        setRole(null);
        setMessage(roleResult.error || 'Admin role required');
        return;
      }

      setRole(roleResult.role);
    }

    setStaging(await listStagingPlaces());
    setApproved(await listApprovedPlaces());
    setRejected(await listRejectedPlaces());
    setDuplicateSuggestions(await listDuplicateSuggestions());
    setLogs(await listAuditLogs());

    const realUsers = await listUsers();
    setRoles(realUsers);
  const nextDraftRoles = Object.fromEntries(realUsers.map((u) => [u.user_id, u.role]));
  setDraftRoles(nextDraftRoles);
    setMessage('');
  } catch (e) {
    setRole(null);
    setMessage(e instanceof Error ? e.message : 'Admin load failed');
  }
};

const reloadRealUsers = async () => {
  const realUsers = await listUsers();
  setRoles(realUsers);
  const nextDraftRoles = Object.fromEntries(realUsers.map((u) => [u.user_id, u.role]));
  setDraftRoles(nextDraftRoles);
};
  const statusCounts = staging.reduce((acc, place) => { const status = place.status || 'pending'; acc[status] = (acc[status] || 0) + 1; return acc; }, {} as Record<string, number>);
  useEffect(() => { load(); }, [auth.loading, auth.session?.access_token]);
  const guarded = async (fn: () => Promise<void>) => { try { await fn(); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Action failed'); } };

  // --- Admin restricted access ---
  if (!isLocalMode && (!role || role === 'checking')) return <div className="gs-admin-panel p-4 text-sm">Admin role required or role API failed.
Email: {authEmail || '(unknown)'}
UID: {authUserId || '(unknown)'}</div>;

  // --- Banner ---
  const banners = <>
    {message && <div className="gs-admin-banner gs-admin-banner--warning p-2 text-sm mb-3">{message}</div>}
    {isLocalMode && <div className="gs-admin-banner gs-admin-banner--info p-2 text-sm mb-3">LOCAL ADMIN MODE: data is stored in browser localStorage for instant edits and import.</div>}
  </>;

  // --- Sidebar nav items ---
  const navItems = [
    { key: 'pending', icon: '🏥', label: 'Pending Queue', count: statusCounts.pending || 0 },
    { key: 'approved', icon: '✅', label: 'Approved', count: approved.length },
    { key: 'rejected', icon: '❌', label: 'Rejected', count: rejected.length },
    { key: 'duplicates', icon: '🔀', label: 'Duplicates', count: duplicateSuggestions.length },
    { key: 'import', icon: '📥', label: 'Import Data' },
    { key: 'users', icon: '👥', label: 'User Management' },
    { key: 'audit', icon: '📋', label: 'Audit Logs' },
    { key: 'settings', icon: '⚙️', label: 'AI Routing' },
  ];

  // --- Filtered + paginated pending data ---
  const filteredStaging = useMemo(() => {
    if (filterCategory === 'all') return staging;
    return staging.filter((p) => {
      const cat = (p.category || '').toLowerCase();
      return cat.includes(filterCategory);
    });
  }, [staging, filterCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredStaging.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredStaging.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filterCategory]);

  // --- Right panel content ---
  const renderMainContent = () => {
    switch (activeSection) {
      case 'pending':
        return <div className="gs-admin-main-card">
          <h3>🏥 Doctor Gatekeeper: รออนุมัติ ({staging.length})</h3>
          <p className="gs-admin-section-desc">รายการจาก LINE/Public จะเข้าคิว pending เพื่อให้ Admin ตรวจสอบก่อนเผยแพร่</p>

          {/* Filter tabs */}
          <div className="gs-admin-filter-bar">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                className={`gs-admin-filter-btn ${filterCategory === f ? 'gs-admin-filter-btn--active' : ''}`}
                onClick={() => setFilterCategory(f)}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Batch approval controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="travel-btn--success gs-admin-btn px-3 py-2 rounded text-xs" onClick={() => guarded(async () => {
              let success = 0, fail = 0;
              for (const p of staging) {
                try { await approvePlace(p); success++; } catch { fail++; }
              }
              setSelectedStagingIds(new Set());
              setMessage(`อนุมัติทั้งหมด: ${success} สำเร็จ, ${fail} ล้มเหลว`);
            })}>อนุมัติทั้งหมด ({staging.length})</button>
            {selectedStagingIds.size > 0 && (
              <button className="travel-btn--success gs-admin-btn px-3 py-2 rounded text-xs" onClick={() => guarded(async () => {
                let success = 0, fail = 0;
                for (const id of selectedStagingIds) {
                  const p = staging.find((s) => s.id === id);
                  if (p) { try { await approvePlace(p); success++; } catch { fail++; } }
                }
                setSelectedStagingIds(new Set());
                setMessage(`อนุมัติที่เลือก: ${success} สำเร็จ, ${fail} ล้มเหลว`);
              })}>อนุมัติที่เลือก ({selectedStagingIds.size})</button>
            )}
          </div>

          {filteredStaging.length === 0 ? (
            <div className="gs-admin-empty">
              {staging.length === 0
                ? 'No pending items to review.'
                : `No pending items match "${filterCategory}" filter.`}
            </div>
          ) : (
            <>
              <div className="gs-admin-table-wrap">
                <table className="gs-admin-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" onChange={() => {
                        if (selectedStagingIds.size === pageItems.length) {
                          setSelectedStagingIds(new Set());
                        } else {
                          setSelectedStagingIds(new Set(pageItems.filter((p) => p.id).map((p) => p.id!)));
                        }
                      }} checked={selectedStagingIds.size === pageItems.length && pageItems.length > 0} /></th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Submitter</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input type="checkbox" checked={p.id ? selectedStagingIds.has(p.id) : false} onChange={() => {
                            if (!p.id) return;
                            const next = new Set(selectedStagingIds);
                            if (next.has(p.id)) { next.delete(p.id); } else { next.add(p.id); }
                            setSelectedStagingIds(next);
                          }} />
                        </td>
                        <td>
                          <div className="gs-admin-thumb">
                            {p.local_media?.length && p.local_media[0].data_url ? (
                              <img src={p.local_media[0].data_url} alt="" />
                            ) : (
                              '📷'
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="gs-admin-table-name" onClick={() => onEdit(p)}>{p.name}</span>
                        </td>
                        <td>
                          <span className="gs-admin-badge gs-admin-badge--category">{p.category || '—'}</span>
                        </td>
                        <td className="text-xs text-slate-500">{p.contributor_name || p.line_display_name || p.email || '—'}</td>
                        <td className="text-xs text-slate-500">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
                        <td>
                          <div className="gs-admin-table-actions">
                            <button className="travel-btn--success" onClick={() => guarded(async () => { setMessage('Approving...'); await approvePlace(p); setMessage('Approved and reloaded'); })}>อนุมัติ</button>
                            <button className="travel-btn--warning" onClick={() => guarded(async () => { setMessage('Rejecting...'); await rejectPlace(p.id!, prompt('เหตุผลการ reject') || 'ไม่ผ่านการตรวจ'); setMessage('Rejected and reloaded'); })}>Reject</button>
                            <button className="travel-btn--purple" onClick={() => onEdit(p)}>แก้ไข</button>
                            <button className="travel-btn--danger" onClick={() => guarded(async () => { setMessage('Deleting staging record...'); await deletePlace(p.id!, 'staging_places'); setMessage('Deleted and reloaded'); })}>ลบ</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="gs-admin-pagination">
                  <span className="gs-admin-pagination-info">
                    Showing {(safePage - 1) * ROWS_PER_PAGE + 1}–{Math.min(safePage * ROWS_PER_PAGE, filteredStaging.length)} of {filteredStaging.length}
                    {filterCategory !== 'all' ? ` (${filterCategory})` : ''}
                  </span>
                  <div className="gs-admin-pagination-actions">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        className={`gs-admin-pagination-btn ${safePage === p ? 'gs-admin-pagination-btn--active' : ''}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>;

      case 'approved':
        return <div className="gs-admin-main-card">
          <h3>✅ Production Search Data ({approved.length})</h3>
          {approved.length === 0 ? (
            <div className="gs-admin-empty">No approved places yet.</div>
          ) : (
            <div className="space-y-2">
              {approved.map((p) => (
                <div key={p.id} className="rounded-xl p-3 text-sm flex justify-between items-center border border-slate-200">
                  <span className="font-semibold">{p.name} — <span className="text-slate-500">{p.category}</span></span>
                  <div className="flex gap-2">
                    <button className="travel-btn--purple gs-admin-btn px-2 py-1 rounded" onClick={() => onEdit(p)}>แก้ไข</button>
                    <button className="travel-btn--danger gs-admin-btn px-2 py-1 rounded" onClick={() => guarded(async () => { await deletePlace(p.id!, 'production_places'); })}>ลบ</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="travel-btn--primary gs-admin-btn mt-3 px-3 py-2 rounded text-sm" onClick={() => guarded(async () => { await saveStagingPlace({ name: 'New place', province: 'กรุงเทพมหานคร', category: 'อื่นๆ (โปรดระบุ)', rating: 5, amenities: [], alerts: [], status: 'pending' }); })}>เพิ่มข้อมูลตัวอย่างเพื่อแก้ไข</button>
        </div>;

      case 'rejected':
        return <div className="gs-admin-main-card">
          <h3>❌ Rejected Queue ({rejected.length})</h3>
          {rejected.length === 0 ? (
            <div className="gs-admin-empty">No rejected records.</div>
          ) : (
            <div className="space-y-2">
              {rejected.map((p) => (
                <div key={p.id} className="rounded-xl p-3 text-sm flex justify-between items-center border border-red-200 bg-red-50">
                  <span>{p.name} — {p.province} — rejected{p.rejection_reason ? ` — ${p.rejection_reason}` : ''}</span>
                  <div className="flex gap-2">
                    <button className="travel-btn--purple gs-admin-btn px-2 py-1 rounded" onClick={() => onEdit(p)}>แก้ไข</button>
                    <button className="travel-btn--danger gs-admin-btn px-2 py-1 rounded" onClick={() => guarded(async () => { setMessage('Deleting staging record...'); await deletePlace(p.id!, 'staging_places'); setMessage('Deleted and reloaded'); })}>ลบ</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>;

      case 'duplicates':
        return <div className="gs-admin-main-card">
          <h3>🔀 Duplicate Suggestions ({duplicateSuggestions.length})</h3>
          <p className="gs-admin-section-desc">ระบบแนะนำรายการที่อาจเป็นสถานที่เดียวกัน ยังไม่รวมให้อัตโนมัติ ต้องให้ Admin ตรวจเอง</p>
          <div className="space-y-2">
            {duplicateSuggestions.length === 0 ? <div className="gs-admin-empty">No possible duplicates.</div> : duplicateSuggestions.map((item) => (
              <div key={item.id} className="rounded-xl p-3 text-sm border border-amber-200 bg-amber-50 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-amber-900">Possible Duplicate {item.score}%</span>
                  <span className="text-xs text-amber-800">{item.reasons.join(', ')}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-2">
                  <div className="rounded-xl p-2 border border-slate-200">
                    <div className="text-xs travel-meta">Primary</div>
                    <div>{item.primary.name} — {item.primary.province}</div>
                    <button className="travel-btn--purple gs-admin-btn px-2 py-1 rounded mt-2" onClick={() => onEdit(item.primary)}>แก้ไข Primary</button>
                  </div>
                  <div className="rounded-xl p-2 border border-slate-200">
                    <div className="text-xs travel-meta">Candidate</div>
                    <div>{item.candidate.name} — {item.candidate.province}</div>
                    <button className="travel-btn--purple gs-admin-btn px-2 py-1 rounded mt-2" onClick={() => onEdit(item.candidate)}>แก้ไข Candidate</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>;

      case 'import':
        return <div className="gs-admin-main-card">
          <h3>📥 Import CSV/JSON</h3>
          <textarea className="travel-input gs-admin-import-input w-full p-2 text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="name,province,category,rating" />
          <button className="travel-btn--primary gs-admin-btn mt-2 px-3 py-2 rounded" onClick={() => guarded(async () => { const result = await importPlaces(importText); setMessage(`Imported ${result.imported}/${result.total}`); })}>Import</button>
        </div>;

      case 'users':
        return <div className="gs-admin-main-card">
          <h3>👥 User Management</h3>
          <p className="text-xs text-amber-800 mb-3">Runtime action status: {message || 'Ready'}</p>
          <div className="mb-4 p-3 rounded-xl border border-slate-200">
            <h4 className="text-sm font-semibold mb-2">Create / Update Auth User</h4>
            <div className="space-y-2">
              <input className="travel-input w-full p-2 text-xs" placeholder="Display name" value={addUserDisplayName} onChange={(e) => setAddUserDisplayName(e.target.value)} />
              <input className="travel-input w-full p-2 text-xs" placeholder="Email" type="email" value={addUserEmail} onChange={(e) => setAddUserEmail(e.target.value)} />
              <input className="travel-input w-full p-2 text-xs" placeholder="Temporary password / new password" type="password" value={addUserPassword} onChange={(e) => setAddUserPassword(e.target.value)} />
              <div className="flex gap-2">
                <select className="travel-input flex-1 p-2 text-xs" value={addUserRole} onChange={(e) => setAddUserRole(e.target.value as any)}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="travel-btn--success gs-admin-btn px-3 py-2 rounded text-xs" onClick={() => guarded(async () => { if (!addUserEmail.trim()) { setMessage('Email required'); return; }
                  if (!addUserPassword.trim() || addUserPassword.trim().length < 6) { setMessage('Password required, minimum 6 characters'); return; }
                  setBusyMessage('Creating/updating auth user...');
                  await addUser(addUserDisplayName || addUserEmail.split('@')[0], addUserEmail, addUserRole, addUserPassword);
                  setAddUserDisplayName('');
                  setAddUserEmail('');
                  setAddUserPassword('');
                  setAddUserRole('viewer');
                  await reloadRealUsers();
                  setMessage('Auth user created/updated and verified after reload'); })}>Add</button>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Users ({roles.length})</h4>
            {roles.length === 0 ? (
              <div className="text-xs travel-meta italic">No users yet</div>
            ) : (
              roles.map((user) => (
                <div key={user.user_id} className="rounded-xl p-4 border border-slate-200">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Left: User Info */}
                    <div className="space-y-1">
                      <p className="font-semibold text-sm">{user.display_name || user.email || 'User'}</p>
                      <p className="travel-meta text-xs break-all">{user.email || 'EMAIL_MISSING_FROM_API'}</p>
                      <p className="travel-meta text-xs break-all">ID: {user.user_id.substring(0, 16)}...</p>
                      <p className="travel-meta text-xs pt-2">Created: {new Date(user.created_at).toLocaleDateString()}</p>
                    </div>

                    {/* Middle: Status & Role Badges */}
                    <div className="flex flex-col gap-2">
                      <span className={`inline-flex w-fit px-3 py-1 rounded text-xs font-semibold ${user.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                        {user.status}
                      </span>
                      <span className="inline-flex w-fit px-3 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">{user.role}</span>
                    </div>

                    {/* Right: Controls */}
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <select
                          className="travel-input text-xs px-2 py-2 w-full"
                          value={draftRoles[user.user_id] || user.role}
                          onChange={(e) => {
                            const nextRole = e.target.value;
                            setDraftRoles((prev) => ({ ...prev, [user.user_id]: nextRole }));
                            setMessage('Role selected: ' + nextRole + '. Click Save Role to apply.');
                          }}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          className="travel-btn--primary gs-admin-btn px-3 py-2 rounded text-xs"
                          type="button"
                          onClick={() => guarded(async () => {
                            const nextRole = (draftRoles[user.user_id] || user.role) as any;
                            setBusyUserId(user.user_id);
                            setMessage('Saving role...');
                            await updateUserRole(user.user_id, nextRole);
                            await reloadRealUsers();
                            setBusyUserId('');
                            setMessage('Role saved as ' + nextRole + ' and verified after reload');
                          })}
                        >
                          Save Role
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {user.status === 'active' && (
                          <button className="travel-btn--warning gs-admin-btn px-3 py-2 rounded text-xs flex-1" onClick={() => guarded(async () => { await disableUser(user.user_id); })}>Disable</button>
                        )}
                        <button className="travel-btn--danger gs-admin-btn px-3 py-2 rounded text-xs flex-1" onClick={() => guarded(async () => { if (confirm('Delete user?')) { setBusyUserId(user.user_id);
                            setMessage('Deleting user role...');
                            await deleteUser(user.user_id);
                            await reloadRealUsers();
                            setBusyUserId('');
                            setMessage('User role deleted and verified after reload'); } })}>Delete</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>;

      case 'audit':
        return <div className="gs-admin-main-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 style={{ margin: 0 }}>📋 Audit logs ({logs.length})</h3>
            <button className="travel-btn--secondary gs-admin-btn px-3 py-2 rounded text-xs" type="button" onClick={() => setShowAuditLogs((value) => !value)}>
              {showAuditLogs ? 'Hide Audit' : 'Show Audit'}
            </button>
          </div>
          {showAuditLogs ? (
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 p-3">
              {logs.slice(0, 10).map((l) => <div className="text-xs" key={l.id}>{l.created_at} — {l.action} — {l.entity_type}</div>)}
              {logs.length > 10 ? <p className="mt-2 text-xs travel-meta">Showing latest 10 of {logs.length}. Full audit search later.</p> : null}
            </div>
          ) : (
            <p className="text-sm travel-meta">Audit logs hidden. Click Show Audit when needed.</p>
          )}
        </div>;

      case 'settings':
        return <div className="gs-admin-main-card">
          <h3>⚙️ AI Routing Settings</h3>
          <p className="gs-admin-section-desc">Jarvis/Sentinel/Foresight provider agnostic monitoring readiness</p>
          <select className="travel-input p-2 text-xs" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
            <option value="jarvis-gpt4o">Jarvis</option>
            <option value="sentinel-claude">Sentinel</option>
            <option value="foresight-gemini">Foresight</option>
          </select>
        </div>;

      default:
        return null;
    }
  };

  return <div className="gs-admin-page animate-fade-in">
    {banners}
    <div className="gs-admin-layout">
      {/* SIDEBAR */}
      <div className="gs-admin-sidebar">
        {/* Nav */}
        <div className="gs-admin-sidebar-card">
          <div className="gs-admin-nav">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`gs-admin-nav-btn ${activeSection === item.key ? 'gs-admin-nav-btn--active' : ''}`}
                onClick={() => setActiveSection(item.key)}
              >
                <span className="gs-admin-nav-icon">{item.icon}</span>
                {item.label}
                {'count' in item && item.count !== undefined ? (
                  <span className="gs-admin-nav-badge">{item.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="gs-admin-main">
        <AdminProfileChip auth={auth} role={role} isLocalMode={isLocalMode} />
        {renderMainContent()}
      </div>
    </div>
  </div>;
}