'use client';
import { ALERTS, AMENITIES, CATEGORIES, MEDIA_UPLOAD_ENABLED, PROVINCES, SUBCATEGORIES } from '@/lib/constants';
import type { PlaceRecord } from '@/services/placesService';

export const emptyMemberPlace: PlaceRecord = { name: '', province: '', category: CATEGORIES[0], other_category: '', sub_category: '', google_maps_url: '', phone: '', recommender: '', suggestion: '', rating: 5, amenities: [], alerts: [], status: 'pending' };

type MemberTabProps = {
  form: PlaceRecord;
  setForm: (place: PlaceRecord | ((prev: PlaceRecord) => PlaceRecord)) => void;
  onSubmit: (event: React.FormEvent) => void;
  attachFile: (file: File | undefined, type: 'image' | 'video') => void;
};

export default function MemberTab({ form, setForm, onSubmit, attachFile }: MemberTabProps) {
  const toggleCheck = (item: string, field: 'amenities' | 'alerts') => setForm((prev) => ({ ...prev, [field]: prev[field].includes(item) ? prev[field].filter((i) => i !== item) : [...prev[field], item] }));
  return <form onSubmit={onSubmit} className="space-y-4" data-media-enabled={MEDIA_UPLOAD_ENABLED}>
    <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อสถานที่ *" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
    <div className="grid md:grid-cols-2 gap-2"><input list="provinces" className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="จังหวัด *" value={form.province} onChange={(e) => setForm({...form, province: e.target.value})} /><datalist id="provinces">{PROVINCES.map((p) => <option key={p} value={p} />)}</datalist><select className="w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.category} onChange={(e) => setForm({...form, category: e.target.value})}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
    {form.category === 'อื่นๆ (โปรดระบุ)' && <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ระบุหมวดหมู่" value={form.other_category || ''} onChange={(e) => setForm({...form, other_category: e.target.value})} />}
    <input list="subcategories" className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="หมวดหมู่ย่อย" value={form.sub_category || ''} onChange={(e) => setForm({...form, sub_category: e.target.value})} /><datalist id="subcategories">{SUBCATEGORIES.map((p) => <option key={p} value={p} />)}</datalist>
    <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์ Google Maps" value={form.google_maps_url || ''} onChange={(e) => setForm({...form, google_maps_url: e.target.value})} />
    <div className="grid md:grid-cols-2 gap-2"><input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="เบอร์โทร/ไลน์" value={form.phone || ''} onChange={(e) => setForm({...form, phone: e.target.value})} /><input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อผู้แนะนำ" value={form.recommender || ''} onChange={(e) => setForm({...form, recommender: e.target.value})} /></div>
    <textarea className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ช่องใส่ข้อแนะนำ/เหตุผล" value={form.suggestion || ''} onChange={(e) => setForm({...form, suggestion: e.target.value})} />
    <div className="grid md:grid-cols-2 gap-2"><label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">📸 แนบรูป<input hidden type="file" accept="image/*" onChange={(e) => attachFile(e.target.files?.[0], 'image')} /></label><label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">🎥 แนบ VDO<input hidden type="file" accept="video/*" onChange={(e) => attachFile(e.target.files?.[0], 'video')} /></label></div>
    {!MEDIA_UPLOAD_ENABLED && <p className="text-xs text-yellow-300">Media upload not enabled yet. Set VITE_MEDIA_UPLOAD_ENABLED=true after Supabase Storage is ready.</p>}
    <select className="w-full p-2 bg-gray-700 rounded border border-gray-600" onChange={(e) => setForm({...form, rating: Number(e.target.value)})} value={form.rating}>{[5,4,3,2,1].map((r) => <option key={r} value={r}>{'⭐'.repeat(r)}</option>)}</select>
    <div className="text-xs font-bold text-gray-400">สิ่งอำนวยความสะดวก:</div><div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{AMENITIES.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.amenities.includes(a)} onChange={() => toggleCheck(a, 'amenities')} /> {a}</label>)}</div>
    <div className="text-xs font-bold text-gray-400">ข้อควรระวัง:</div><div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{ALERTS.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleCheck(a, 'alerts')} /> {a}</label>)}</div>
    <button type="submit" className="w-full p-3 bg-blue-600 rounded font-bold hover:bg-blue-700">🚀 {form.id ? 'อัปเดตข้อมูล' : 'บันทึกเข้าคลัง'}</button>
  </form>;
}
