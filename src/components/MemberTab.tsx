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
  const [optionalOpen, setOptionalOpen] = useState(false);
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

  return (
    <form onSubmit={onSubmit} className="gs-member-page" data-media-enabled={MEDIA_UPLOAD_ENABLED}>
      {/* LEFT COLUMN — Info sidebar (no stepper) */}
      <div className="gs-member-steps">
        <span>แนะนำสถานที่</span>
        <div className="gs-member-step gs-member-step--active">
          <div className="gs-member-step-dot">1</div>
          <div>
            <strong>ข้อมูลหลัก</strong>
            <small>ชื่อ, จังหวัด, หมวดหมู่</small>
          </div>
        </div>
        <div className="gs-member-step">
          <div className="gs-member-step-dot">2</div>
          <div>
            <strong>ข้อมูลเพิ่มเติม</strong>
            <small>ไม่บังคับ</small>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN — Single-page form */}
      <div className="gs-member-form-card">
        <h2 className="travel-section-title" style={{ marginBottom: 16 }}>ข้อมูลหลัก</h2>

        {/* Required fields — always visible */}
        <input
          className="travel-input w-full p-2 rounded border"
          placeholder="ชื่อสถานที่ *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid md:grid-cols-2 gap-2">
          <input
            list="provinces"
            className="travel-input w-full p-2 rounded border"
            placeholder="จังหวัด *"
            value={form.province}
            onChange={(e) => setForm({ ...form, province: e.target.value })}
          />
          <datalist id="provinces">{PROVINCES.map((p) => <option key={p} value={p} />)}</datalist>
          <select
            className="travel-input w-full p-2 rounded border"
            value={form.category}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {form.category === 'อื่นๆ' && (
          <input
            className="travel-input w-full p-2 rounded border"
            placeholder="ระบุหมวดหมู่"
            value={form.other_category || ''}
            onChange={(e) => setForm({ ...form, other_category: e.target.value })}
          />
        )}
        <select
          className="travel-input w-full p-2 rounded border"
          value={form.sub_category || ''}
          onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
          disabled={!currentSubcategories.length || form.category === '-- เลือกหมวดหมู่หลัก --'}
        >
          <option value="">{form.category && form.category !== '-- เลือกหมวดหมู่หลัก --' ? 'เลือกหมวดย่อย' : 'เลือกหมวดหมู่ก่อน'}</option>
          {currentSubcategories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <textarea
          className="travel-input w-full p-2 rounded border"
          placeholder="คำอธิบายสั้น (ไม่บังคับ)"
          value={form.suggestion || ''}
          onChange={(e) => setForm({ ...form, suggestion: e.target.value })}
          rows={3}
        />

        {/* Rating — always visible */}
        <select
          className="travel-input w-full p-2 rounded border"
          onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
          value={form.rating}
        >
          {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{'⭐'.repeat(r)}</option>)}
        </select>

        {/* Collapsible: ข้อมูลเพิ่มเติม (ไม่บังคับ) */}
        <div className="gs-member-optional-header" onClick={() => setOptionalOpen(!optionalOpen)} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <span>{optionalOpen ? '▼' : '▶'} ข้อมูลเพิ่มเติม (ไม่บังคับ)</span>
        </div>

        {optionalOpen && (
          <div className="gs-member-optional">
            {/* Image upload */}
            <div className="grid md:grid-cols-2 gap-2">
              <label className="p-2 bg-gray-100 rounded text-sm border cursor-pointer flex items-center gap-2">
                📸 แนบรูป
                <input hidden type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => attachFile(e.target.files?.[0], 'image')} />
              </label>
              <label className="p-2 bg-gray-100 rounded text-sm border cursor-pointer flex items-center gap-2">
                🎥 แนบ VDO
                <input hidden type="file" accept="video/mp4,video/webm" onChange={(e) => attachFile(e.target.files?.[0], 'video')} />
              </label>
            </div>
            {form.local_media?.length ? (
              <div className="text-xs" style={{ color: '#64748b' }}>ไฟล์แนบ: {form.local_media.map((m) => m.file_name).join(', ')}</div>
            ) : null}
            {!MEDIA_UPLOAD_ENABLED && (
              <p className="text-xs" style={{ color: '#92400e' }}>Media upload not enabled yet. Set VITE_MEDIA_UPLOAD_ENABLED=true after Supabase Storage is ready.</p>
            )}

            {/* Map link */}
            <input
              className="travel-input w-full p-2 rounded border"
              placeholder="ลิงก์ Google Maps"
              value={form.google_maps_url || ''}
              onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })}
            />

            {/* Additional info */}
            <div className="grid md:grid-cols-2 gap-2">
              <input className="travel-input w-full p-2 rounded border" placeholder="ชื่อเล่น / nickname" value={form.contributor_name || ''} onChange={(e) => setForm({ ...form, contributor_name: e.target.value })} />
              <input className="travel-input w-full p-2 rounded border" placeholder="LINE display name" value={form.line_display_name || ''} onChange={(e) => setForm({ ...form, line_display_name: e.target.value })} />
              <input className="travel-input w-full p-2 rounded border" placeholder="อีเมล" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="travel-input w-full p-2 rounded border" placeholder="เบอร์โทร/ไลน์" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="travel-input w-full p-2 rounded border" placeholder="ชื่อผู้แนะนำ" value={form.recommender || ''} onChange={(e) => setForm({ ...form, recommender: e.target.value })} />
            </div>

            <div className="rounded-xl border p-3 text-xs space-y-1" style={{ background: '#fffbeb', borderColor: 'rgba(245,158,11,0.25)', color: '#92400e' }}>
              <p>{MEDIA_POLICY_TEXT}</p>
              <p>{VIDEO_COST_POLICY_TEXT}</p>
            </div>

            <div className="grid md:grid-cols-3 gap-2">
              <select className="travel-input w-full p-2 rounded border" value={form.media_type || ''} onChange={(e) => setForm({ ...form, media_type: (e.target.value || null) as any })}>
                <option value="">ชนิดสื่อ (ไม่บังคับ)</option>
                <option value="image">รูปภาพ</option>
                <option value="video">วิดีโอ</option>
              </select>
              <input className="travel-input w-full p-2 rounded border" placeholder="ลิงก์รูปภาพหรือวิดีโอ" value={form.media_url || ''} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
              <input className="travel-input w-full p-2 rounded border" placeholder="คำอธิบายสื่อ" value={form.media_caption || ''} onChange={(e) => setForm({ ...form, media_caption: e.target.value })} />
            </div>

            {/* Amenities */}
            <div>
              <div className="text-xs font-bold" style={{ color: '#64748b', marginBottom: 6 }}>สิ่งอำนวยความสะดวก:</div>
              <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">
                {AMENITIES.map((a) => (
                  <label key={a} className="flex gap-1 items-center" style={{ padding: '6px 8px', borderRadius: 8, background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <input type="checkbox" checked={form.amenities.includes(a)} onChange={() => toggleCheck(a, 'amenities')} /> {a}
                  </label>
                ))}
              </div>
            </div>

            {/* Alerts */}
            <div>
              <div className="text-xs font-bold" style={{ color: '#64748b', marginBottom: 6 }}>ข้อควรระวัง:</div>
              <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">
                {ALERTS.map((a) => (
                  <label key={a} className="flex gap-1 items-center" style={{ padding: '6px 8px', borderRadius: 8, background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleCheck(a, 'alerts')} /> {a}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Submit button — always visible */}
        <div className="gs-member-step-buttons">
          <button type="submit" className="travel-btn travel-btn--primary">ส่งข้อมูล</button>
        </div>
      </div>
    </form>
  );
}