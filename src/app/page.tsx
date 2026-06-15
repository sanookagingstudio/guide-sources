'use client';

import { useEffect, useState } from 'react';
import SearchTab from '@/components/SearchTab';
import AdminTab from '@/components/AdminTab';
import MemberTab, { emptyMemberPlace } from '@/components/MemberTab';
import { CATEGORIES, MEDIA_UPLOAD_ENABLED } from '@/lib/constants';
import { findDuplicatePlaceName, saveStagingPlace, type PlaceRecord } from '@/services/placesService';
import { uploadPlaceMedia } from '@/services/mediaService';

type Tab = 'search' | 'member' | 'admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('member');
  const [form, setForm] = useState<PlaceRecord>(emptyMemberPlace);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<{file: File; type: 'image' | 'video'}[]>([]);

  useEffect(() => { setMessage(form.id ? `กำลังแก้ไข: ${form.name}` : ''); }, [form.id, form.name]);
  const editPlace = (place: PlaceRecord) => { setForm({ ...emptyMemberPlace, ...place, status: 'pending' }); setActiveTab('member'); };
  const attachFile = (file: File | undefined, type: 'image' | 'video') => { if (!file) return; if (!MEDIA_UPLOAD_ENABLED) { setMessage('Media upload not enabled yet — ตั้งค่า VITE_MEDIA_UPLOAD_ENABLED=true และ Supabase Storage ก่อนใช้งาน'); return; } setPendingFiles((prev) => [...prev, { file, type }]); };

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

  return <div className="mx-auto w-full max-w-[960px] p-4 bg-gray-900 text-white min-h-screen">
    <nav className="flex bg-gray-800 p-2 rounded-lg mb-4 sticky top-0 z-10">
      <button onClick={() => setActiveTab('search')} className={`flex-1 p-2 rounded ${activeTab === 'search' ? 'bg-blue-600' : ''}`}>🔍 ค้นหา</button>
      <button onClick={() => setActiveTab('member')} className={`flex-1 p-2 rounded ${activeTab === 'member' ? 'bg-blue-600' : ''}`}>👤 Member</button>
      <button onClick={() => setActiveTab('admin')} className={`flex-1 p-2 rounded ${activeTab === 'admin' ? 'bg-blue-600' : ''}`}>⚙️ Admin</button>
    </nav>
    {message && <div className="mb-4 rounded border border-blue-700 bg-blue-950/50 p-3 text-sm">{message}</div>}
    {activeTab === 'search' && <SearchTab refreshKey={refreshKey} onEdit={editPlace} />}
    {activeTab === 'member' && <MemberTab form={form} setForm={setForm} onSubmit={handleSubmit} attachFile={attachFile} />}
    {activeTab === 'admin' && <AdminTab onEdit={editPlace} />}
  </div>;
}

