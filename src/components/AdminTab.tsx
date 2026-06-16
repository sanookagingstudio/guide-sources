'use client';
import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '@/lib/supabase';
import { 
  approvePlace, 
  getCurrentAdminRole, 
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
import { deletePlace, listApprovedPlaces, listStagingPlaces, listRejectedPlaces, saveStagingPlace, type PlaceRecord } from '@/services/placesService';
import { importPlaces } from '@/services/importService';

export default function AdminTab({ onEdit }: { onEdit: (place: PlaceRecord) => void }) {
  const [role, setRole] = useState<string | null>('checking');
  const [staging, setStaging] = useState<PlaceRecord[]>([]);
  const [approved, setApproved] = useState<PlaceRecord[]>([]);
  const [rejected, setRejected] = useState<PlaceRecord[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [roles, setRoles] = useState<LocalUser[]>([]);
  const [message, setMessage] = useState('');
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [importText, setImportText] = useState('');
  const [newRole, setNewRole] = useState<'admin'|'editor'|'viewer'>('viewer');
  const [aiProvider, setAiProvider] = useState('jarvis-gpt4o');
  
  // User management form
  const [addUserDisplayName, setAddUserDisplayName] = useState('');
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addUserRole, setAddUserRole] = useState<'admin'|'editor'|'viewer'>('viewer');
  const isLocalMode = !isSupabaseConfigured;
  const load = async () => { try { if (isLocalMode) { setRole('admin'); } else { setRole(await getCurrentAdminRole()); } setStaging(await listStagingPlaces()); setApproved(await listApprovedPlaces()); setRejected(await listRejectedPlaces()); setLogs(await listAuditLogs()); setRoles(await listUserRoles()); } catch (e) { setMessage(e instanceof Error ? e.message : 'Admin load failed'); } };
  const statusCounts = staging.reduce((acc, place) => { const status = place.status || 'pending'; acc[status] = (acc[status] || 0) + 1; return acc; }, {} as Record<string, number>);
  useEffect(() => { load(); }, []);
  const guarded = async (fn: () => Promise<void>) => { try { await fn(); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Action failed'); } };
  if (!isLocalMode && (!role || role === 'checking')) return <div className="bg-gray-800 p-4 rounded border border-gray-700">Admin role required. Sign in with a user listed in user_roles.</div>;
  return <div className="space-y-6 animate-fade-in">
    {message && <div className="bg-yellow-950 border border-yellow-700 rounded p-2 text-sm">{message}</div>}
    {isLocalMode && <div className="bg-emerald-950 border border-emerald-700 rounded p-2 text-sm">LOCAL ADMIN MODE: data is stored in browser localStorage for instant edits and import.</div>}
    <div className="grid grid-cols-3 gap-2 text-xs"><div className="travel-stat-card p-3">Pending: {statusCounts.pending || 0}</div><div className="travel-stat-card p-3">Approved: {(statusCounts.approved || 0) + approved.length}</div><div className="travel-stat-card p-3">Rejected: {rejected.length}</div></div>
    <div className="travel-card p-4 flex justify-between items-center"><div><h3 className="travel-section-title">🧠 สมองส่วนกลาง (AI Routing)</h3><p className="travel-meta text-xs">Jarvis/Sentinel/Foresight provider agnostic monitoring readiness</p></div><select className="travel-input bg-gray-900 border border-gray-600 rounded p-2 text-xs" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}><option value="jarvis-gpt4o">Jarvis</option><option value="sentinel-claude">Sentinel</option><option value="foresight-gemini">Foresight</option></select></div>
    <section className="travel-card p-4"><h3 className="travel-section-title mb-3">Doctor Gatekeeper: รออนุมัติ ({staging.length})</h3><div className="space-y-2">{staging.map((p) => <div key={p.id} className="bg-gray-900/90 p-3 rounded-xl text-sm flex flex-col md:flex-row md:items-center gap-2 justify-between border border-slate-700"><span className="text-slate-100">{p.name} — {p.province} — {p.status}</span><div className="flex gap-2 flex-wrap"><button className="travel-btn travel-btn--success px-2 py-1 rounded" onClick={() => guarded(async () => { await approvePlace(p); })}>อนุมัติ</button><button className="travel-btn travel-btn--warning px-2 py-1 rounded" onClick={() => guarded(async () => { await rejectPlace(p.id!, prompt('เหตุผลการ reject') || 'ไม่ผ่านการตรวจ'); })}>Reject</button><button className="travel-btn travel-btn--purple px-2 py-1 rounded" onClick={() => onEdit(p)}>แก้ไข</button><button className="travel-btn travel-btn--danger px-2 py-1 rounded" onClick={() => guarded(async () => { await deletePlace(p.id!, 'staging_places'); })}>ลบ</button></div></div>)}</div></section>
    <section className="travel-card p-4">
      <h3 className="travel-section-title mb-3">Rejected Queue ({rejected.length})</h3>
      <div className="space-y-2">
        {rejected.length === 0 ? <p className="text-sm text-slate-400">No rejected records.</p> : rejected.map((p) => (
          <div key={p.id} className="bg-red-950/30 p-3 rounded-xl text-sm flex flex-col md:flex-row md:items-center gap-2 justify-between border border-red-800/60">
            <span className="text-slate-100">{p.name} — {p.province} — rejected{p.rejection_reason ? ` — ${p.rejection_reason}` : ''}</span>
            <div className="flex gap-2 flex-wrap">
              <button className="travel-btn travel-btn--purple px-2 py-1 rounded" onClick={() => onEdit(p)}>แก้ไข</button>
              <button className="travel-btn travel-btn--danger px-2 py-1 rounded" onClick={() => guarded(async () => { await deletePlace(p.id!, 'staging_places'); })}>ลบ</button>
            </div>
          </div>
        ))}
      </div>
    </section>
    <section className="travel-card p-4"><h3 className="travel-section-title mb-3">Production Search Data ({approved.length})</h3>{approved.map((p) => <div key={p.id} className="bg-gray-900/90 p-3 rounded-xl text-sm flex justify-between mb-2 border border-slate-700"><span className="text-slate-100">{p.name} — {p.category}</span><div className="flex gap-2"><button className="travel-btn travel-btn--purple px-2 py-1 rounded" onClick={() => onEdit(p)}>แก้ไข</button><button className="travel-btn travel-btn--danger px-2 py-1 rounded" onClick={() => guarded(async () => { await deletePlace(p.id!, 'production_places'); })}>ลบ</button></div></div>)}<button className="travel-btn travel-btn--primary mt-2 px-3 py-2 rounded text-sm" onClick={() => guarded(async () => { await saveStagingPlace({ name: 'New place', province: 'กรุงเทพมหานคร', category: 'อื่นๆ (โปรดระบุ)', rating: 5, amenities: [], alerts: [], status: 'pending' }); })}>เพิ่มข้อมูลตัวอย่างเพื่อแก้ไข</button></section>
    <section className="travel-card p-4"><h3 className="travel-section-title mb-2">Import CSV/JSON</h3><textarea className="travel-input w-full h-28 bg-gray-900 border border-gray-600 rounded p-2 text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="name,province,category,rating" /><button className="travel-btn travel-btn--primary mt-2 px-3 py-2 rounded" onClick={() => guarded(async () => { const result = await importPlaces(importText); setMessage(`Imported ${result.imported}/${result.total}`); })}>Import</button></section>
    <section className="travel-card p-4">
      <h3 className="travel-section-title mb-3">👥 Local User Management</h3>
      <div className="mb-4 p-3 bg-gray-900 rounded border border-gray-700">
        <h4 className="text-sm font-semibold mb-2 text-slate-100">Add New User</h4>
        <div className="space-y-2">
          <input className="travel-input w-full bg-gray-800 border border-gray-600 rounded p-2 text-xs" placeholder="Display name" value={addUserDisplayName} onChange={(e) => setAddUserDisplayName(e.target.value)} />
          <input className="travel-input w-full bg-gray-800 border border-gray-600 rounded p-2 text-xs" placeholder="Email" type="email" value={addUserEmail} onChange={(e) => setAddUserEmail(e.target.value)} />
          <div className="flex gap-2">
            <select className="travel-input flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-xs" value={addUserRole} onChange={(e) => setAddUserRole(e.target.value as any)}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button className="travel-btn travel-btn--success px-3 py-2 rounded text-xs" onClick={() => guarded(async () => { if (!addUserDisplayName.trim()) { setMessage('Display name required'); return; } await addUser(addUserDisplayName, addUserEmail, addUserRole); setAddUserDisplayName(''); setAddUserEmail(''); setAddUserRole('viewer'); setMessage('User added'); })}>Add</button>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-100">Users ({roles.length})</h4>
        {roles.length === 0 ? (
          <div className="text-xs text-slate-400 italic">No users yet</div>
        ) : (
          roles.map((user) => (
            <div key={user.user_id} className="bg-gray-900 p-4 rounded border border-slate-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Left: User Info */}
                <div className="space-y-1">
                  <p className="text-slate-100 font-semibold text-sm">{user.display_name || 'Unnamed'}</p>
                  <p className="text-slate-400 text-xs break-all">{user.email || '(no email)'}</p>
                  <p className="text-slate-500 text-xs break-all">ID: {user.user_id.substring(0, 16)}...</p>
                  <p className="text-slate-600 text-xs pt-2">Created: {new Date(user.created_at).toLocaleDateString()}</p>
                </div>

                {/* Middle: Status & Role Badges */}
                <div className="flex flex-col gap-2">
                  <span className={`inline-flex w-fit px-3 py-1 rounded text-xs font-semibold ${user.status === 'active' ? 'bg-emerald-900 text-emerald-100' : 'bg-red-900 text-red-100'}`}>
                    {user.status}
                  </span>
                  <span className="inline-flex w-fit px-3 py-1 rounded text-xs font-semibold bg-blue-900 text-blue-100">{user.role}</span>
                </div>

                {/* Right: Controls */}
                <div className="flex flex-col gap-2">
                  <select className="travel-input text-xs bg-gray-800 border border-gray-600 rounded px-2 py-2 w-full" value={user.role} onChange={(e) => guarded(async () => { await updateUserRole(user.user_id, e.target.value as any); })}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="flex gap-2">
                    {user.status === 'active' && (
                      <button className="travel-btn travel-btn--warning px-3 py-2 rounded text-xs flex-1" onClick={() => guarded(async () => { await disableUser(user.user_id); })}>Disable</button>
                    )}
                    <button className="travel-btn travel-btn--danger px-3 py-2 rounded text-xs flex-1" onClick={() => guarded(async () => { if (confirm('Delete user?')) { await deleteUser(user.user_id); } })}>Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
    <section className="travel-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="travel-section-title mb-2">Audit logs ({logs.length})</h3>
        <button className="travel-btn travel-btn--secondary px-3 py-2 rounded text-xs" type="button" onClick={() => setShowAuditLogs((value) => !value)}>
          {showAuditLogs ? 'Hide Audit' : 'Show Audit'}
        </button>
      </div>
      {showAuditLogs ? (
        <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-700 bg-slate-950/40 p-3">
          {logs.slice(0, 10).map((l) => <div className="text-xs text-slate-200" key={l.id}>{l.created_at} — {l.action} — {l.entity_type}</div>)}
          {logs.length > 10 ? <p className="mt-2 text-xs text-slate-500">Showing latest 10 of {logs.length}. Full audit search later.</p> : null}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Audit logs hidden. Click Show Audit when needed.</p>
      )}
    </section>
  </div>;
}


