'use client';
import { useState } from 'react';
import { ALERTS, AMENITIES, CATEGORIES, MEDIA_UPLOAD_ENABLED, PROVINCES, MEDIA_POLICY_TEXT, VIDEO_COST_POLICY_TEXT, getSubcategoriesForCategory, normalizeCategoryLabel } from '@/lib/constants';
import type { PlaceRecord } from '@/services/placesService';

export const emptyMemberPlace: PlaceRecord = { name: '', province: '', category: CATEGORIES[0], other_category: '', sub_category: '', google_maps_url: '', phone: '', recommender: '', suggestion: '', rating: 5, amenities: [], alerts: [], status: 'pending' };

type MemberTabProps = {
  form: PlaceRecord;
  setForm: (place: PlaceRecord | ((prev: PlaceRecord) => PlaceRecord)) => void;
  onSubmit: (event: React.FormEvent) => void;
  attachFile: (file: File | undefined, type: 'image' | 'video') => void;
};

export default function MemberTab({ form, setForm, onSubmit, attachFile }: MemberTabProps) {
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const currentSubcategories = getSubcategoriesForCategory(form.category || '');
  const handleCategoryChange = (category: string) => {
    const normalized = normalizeCategoryLabel(category);
    const options = getSubcategoriesForCategory(normalized);
    setForm((prev) => ({
      ...prev,
      category,
      sub_category: options.includes(prev.sub_category || '') ? prev.sub_category : '',
    }));
  };

  const toggleCheck = (item: string, field: 'amenities' | 'alerts') => setForm((prev) => ({
    ...prev,
    [field]: prev[field].includes(item) ? prev[field].filter((i) => i !== item) : [...prev[field], item],
  }));

  return <form onSubmit={onSubmit} className="travel-card gs-member-page space-y-4 p-4" data-media-enabled={MEDIA_UPLOAD_ENABLED}>
    <div className="space-y-1"><h2 className="travel-section-title">แนะนำสถานที่ใหม่</h2></div>
    <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อสถานที่ *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
    <div className="grid md:grid-cols-2 gap-2">
      <input list="provinces" className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="จังหวัด *" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
      <datalist id="provinces">{PROVINCES.map((p) => <option key={p} value={p} />)}</datalist>
      <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.category} onChange={(e) => handleCategoryChange(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
    {form.category === 'อื่นๆ' && <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ระบุหมวดหมู่" value={form.other_category || ''} onChange={(e) => setForm({ ...form, other_category: e.target.value })} />}
    <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.sub_category || ''} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} disabled={!currentSubcategories.length || form.category === '-- เลือกหมวดหมู่หลัก --'}>
      <option value="">{form.category && form.category !== '-- เลือกหมวดหมู่หลัก --' ? 'เลือกหมวดย่อย' : 'เลือกหมวดหมู่ก่อน'}</option>
      {currentSubcategories.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
    <button type="button" className="travel-btn travel-btn--secondary w-full p-3 rounded text-sm" onClick={() => setShowOptionalFields(!showOptionalFields)}>{showOptionalFields ? "ซ่อนข้อมูลเพิ่มเติม" : "ข้อมูลเพิ่มเติม (แนะนำ)"}</button>{showOptionalFields && <div className="space-y-3"><input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์ Google Maps" value={form.google_maps_url || ''} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} />
    <div className="grid md:grid-cols-2 gap-2">
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อเล่น / nickname (ไม่บังคับ)" value={form.contributor_name || ''} onChange={(e) => setForm({ ...form, contributor_name: e.target.value })} />
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="LINE display name (ไม่บังคับ)" value={form.line_display_name || ''} onChange={(e) => setForm({ ...form, line_display_name: e.target.value })} />
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="อีเมล (ไม่บังคับ)" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="เบอร์โทร/ไลน์" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อผู้แนะนำ" value={form.recommender || ''} onChange={(e) => setForm({ ...form, recommender: e.target.value })} />
    </div>
    <textarea className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ช่องใส่ข้อแนะนำ/เหตุผล" value={form.suggestion || ''} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} />
    <div className="rounded-xl border border-yellow-700 bg-yellow-950/40 p-3 text-xs text-yellow-100 space-y-1">
      <p>{MEDIA_POLICY_TEXT}</p>
      <p>{VIDEO_COST_POLICY_TEXT}</p>
    </div>
    <div className="grid md:grid-cols-3 gap-2">
      <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.media_type || ''} onChange={(e) => setForm({ ...form, media_type: (e.target.value || null) as any })}>
        <option value="">ชนิดสื่อ (ไม่บังคับ)</option>
        <option value="image">รูปภาพ</option>
        <option value="video">วิดีโอ</option>
      </select>
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์รูปภาพหรือวิดีโอ (ไม่บังคับ)" value={form.media_url || ''} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
      <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="คำอธิบายสื่อ (ไม่บังคับ)" value={form.media_caption || ''} onChange={(e) => setForm({ ...form, media_caption: e.target.value })} />
    </div>
    <div className="grid md:grid-cols-2 gap-2">
      <label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">📸 แนบรูป<input hidden type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => attachFile(e.target.files?.[0], 'image')} /></label>
      <label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">🎥 แนบ VDO<input hidden type="file" accept="video/mp4,video/webm" onChange={(e) => attachFile(e.target.files?.[0], 'video')} /></label>
    </div>
    {form.local_media?.length ? <div className="text-xs text-slate-300">ไฟล์แนบ: {form.local_media.map((m) => m.file_name).join(', ')}</div> : null}
    {!MEDIA_UPLOAD_ENABLED && <p className="text-xs text-yellow-300">Media upload not enabled yet. Set VITE_MEDIA_UPLOAD_ENABLED=true after Supabase Storage is ready.</p>}
    <select className="w-full p-2 bg-gray-700 rounded border border-gray-600" onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} value={form.rating}>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{'⭐'.repeat(r)}</option>)}</select>
    <div className="text-xs font-bold text-gray-400">สิ่งอำนวยความสะดวก:</div>
    <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{AMENITIES.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.amenities.includes(a)} onChange={() => toggleCheck(a, 'amenities')} /> {a}</label>)}</div>
    <div className="text-xs font-bold text-gray-400">ข้อควรระวัง:</div>
    <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{ALERTS.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleCheck(a, 'alerts')} /> {a}</label>)}</div>
    {/* END_OPTIONAL_FIELDS_GS */}</div>}<button type="submit" className="travel-btn travel-btn--primary w-full p-3 rounded font-bold">ส่งข้อมูล</button>
  </form>;
}




