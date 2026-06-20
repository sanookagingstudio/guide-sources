'use client';

import AuthPanel from '@/components/AuthPanel';
import { AuthProvider } from '@/components/AuthContext';

import { useEffect, useState } from 'react';
import SearchTab from '@/components/SearchTab';
import AdminTab from '@/components/AdminTab';
import MemberTab, { emptyMemberPlace } from '@/components/MemberTab';
import { CATEGORIES, MEDIA_UPLOAD_ENABLED } from '@/lib/constants';
import { findDuplicatePlaceName, saveStagingPlace, type PlaceRecord } from '@/services/placesService';
import { uploadPlaceMedia } from '@/services/mediaService';
import { isSupabaseConfigured } from '@/lib/supabase';

type Tab = 'search' | 'member' | 'admin';

function RootRecoveryHashHandler() {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash || '';
    if (hash.includes('type=recovery') && !window.location.pathname.includes('/auth/update-password')) {
      window.location.replace('/auth/update-password' + hash);
    }
  }
  return null;
}

// Supabase recovery hash handler
function GuideSourcesApp() {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [form, setForm] = useState<PlaceRecord>(emptyMemberPlace);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<{file: File; type: 'image' | 'video'}[]>([]);

  useEffect(() => { setMessage(form.id ? `กำลังแก้ไข: ${form.name}` : ''); }, [form.id, form.name]);
  const editPlace = (place: PlaceRecord) => { setForm({ ...emptyMemberPlace, ...place, status: 'pending' }); setActiveTab('member'); };
  const attachFile = async (file: File | undefined, type: 'image' | 'video') => {
    if (!file) return;
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/webm'];
    if (type === 'image' && !allowedImageTypes.includes(file.type)) {
      setMessage('Supported image formats: jpg, jpeg, png, webp');
      return;
    }
    if (type === 'video' && !allowedVideoTypes.includes(file.type)) {
      setMessage('Supported video formats: mp4, webm');
      return;
    }

    const useLocalMedia = !MEDIA_UPLOAD_ENABLED || !isSupabaseConfigured;
    if (useLocalMedia) {
      if (type === 'image') {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setForm((prev) => ({
            ...prev,
            local_media: [
              ...(prev.local_media || []),
              { media_type: 'image', file_name: file.name, data_url: dataUrl, created_at: new Date().toISOString() },
            ],
          }));
          setMessage(`เพิ่มรูปแล้ว: ${file.name}`);
        };
        reader.readAsDataURL(file);
      } else {
        setForm((prev) => ({
          ...prev,
          local_media: [
            ...(prev.local_media || []),
            { media_type: 'video', file_name: file.name, created_at: new Date().toISOString() },
          ],
        }));
        setMessage(`เพิ่มวิดีโอแล้ว: ${file.name}`);
      }
      return;
    }

    setPendingFiles((prev) => [...prev, { file, type }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    const missing = [
      !form.name.trim() && 'ชื่อสถานที่',
      !form.province.trim() && 'จังหวัด',
      !form.category.trim() || form.category === '-- เลือกหมวดหมู่หลัก --' && 'หมวดหมู่หลัก',
    ].filter(Boolean) as string[];

    if (missing.length) {
      setMessage(`กรุณากรอกข้อมูลที่จำเป็นก่อนบันทึก: ${missing.join(', ')}`);
      return;
    }

    try {
      const duplicate = await findDuplicatePlaceName(form.name, form.id);
      if (duplicate && !confirm(`พบชื่อสถานที่ซ้ำ: ${duplicate.name} ต้องการบันทึกต่อหรือไม่?`)) return;

      const saved = await saveStagingPlace(form);
      if (saved?.id) {
        for (const pending of pendingFiles) await uploadPlaceMedia(saved.id, pending.file, pending.type, true);
      }

      setMessage(`บันทึกสำเร็จแล้ว: ${saved?.name || form.name} บันทึกลง browser localStorage แล้วและ Search จะโหลดข้อมูลใหม่ทันที`);
      setForm(emptyMemberPlace);
      setPendingFiles([]);
      setRefreshKey((v) => v + 1);
      window.dispatchEvent(new Event('guide-sources-updated'));
      window.dispatchEvent(new Event('guide-sources:refresh'));
      setActiveTab('search');
    } catch (err) {
      const text = err instanceof Error ? err.message : 'unknown error';
      setMessage(`เกิดข้อผิดพลาด: ${text}`);
    }
  };

  return <div className={`mx-auto w-full max-w-[980px] p-3 sm:p-4 min-h-screen gs-ui14-shell${activeTab === 'admin' ? ' gs-theme-admin' : ''}`}>
    <header className="gs-app-header">
  <div className="gs-app-brand">
    <div className="gs-app-logo"><img src="/brand/guide-sources-mascot.png" alt="Guide Sources logo" /></div>
    <div className="gs-app-title-block">
      <p className="gs-app-kicker">TRAVEL SOURCE MANAGER</p>
      <h1 className="gs-app-title">Guide Sources</h1>
      <p className="gs-app-subtitle">ค้นหา • เพิ่มข้อมูล • อนุมัติแหล่งท่องเที่ยว</p>
    </div>
  </div>
  <div className="gs-app-auth">
    <AuthPanel />
  </div>
</header>
    <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/85 p-2 mb-4 sticky top-0 z-10 shadow-xl">
      <button onClick={() => setActiveTab('search')} className={`travel-tab travel-tab--search flex-1 min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black ${activeTab === 'search' ? 'travel-tab--active' : ''}`}>🔍 Search</button>
      <button onClick={() => setActiveTab('member')} className={`travel-tab travel-tab--member flex-1 min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black ${activeTab === 'member' ? 'travel-tab--active' : ''}`}>👤 Member</button>
      <button onClick={() => setActiveTab('admin')} className={`travel-tab travel-tab--admin flex-1 min-h-[48px] rounded-xl border px-3 py-2 text-sm font-black ${activeTab === 'admin' ? 'travel-tab--active' : ''}`}>⚙️ Admin</button>
    </nav>
    {message && <div className="mb-4 rounded-xl border border-sky-700/70 bg-sky-950/60 p-3 text-sm text-sky-100">{message}</div>}
    <div className={`gs-active-tab-panel gs-active-tab-panel--${activeTab}`}>
      {activeTab === 'search' && <SearchTab refreshKey={refreshKey} onEdit={editPlace} />}
      {activeTab === 'member' && <MemberTab form={form} setForm={setForm} onSubmit={handleSubmit} attachFile={attachFile} />}
      {activeTab === 'admin' && <AdminTab onEdit={editPlace} />}
    </div>
  </div>;
}





export default function Home() {
  return (
    <AuthProvider>
      <GuideSourcesApp />
    </AuthProvider>
  );
}


























