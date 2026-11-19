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

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, { title: string; body: string }> = {
  1: { title: 'ข้อมูลหลัก', body: 'ข้อมูลที่จำเป็นสำหรับการเพิ่มสถานที่' },
  2: { title: 'ข้อมูลเพิ่มเติม', body: 'สื่อ คุณภาพข้อมูล และสิ่งอำนวยความสะดวก' },
  3: { title: 'สื่อและตรวจสอบ', body: 'ตรวจสอบข้อมูลก่อนส่งเข้าคิว' },
};

export default function MemberTab({ form, setForm, onSubmit, attachFile }: MemberTabProps) {
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  // GS-06: the documented three-step workflow. The step is client state; the
  // submit event still carries the whole form, so persistence is unchanged.
  const [step, setStep] = useState<Step>(1);
  const [stepError, setStepError] = useState('');
  const currentSubcategories = getSubcategoriesForCategory(form.category || '');

  const categoryMissing = !form.category.trim() || form.category.startsWith('--');
  const primaryMissing = !form.name.trim() || !form.province.trim() || categoryMissing;

  const goToStep = (target: Step) => {
    if (target > 1 && primaryMissing) {
      setStepError('กรุณากรอกชื่อสถานที่ จังหวัด และหมวดหมู่ก่อนดำเนินการต่อ');
      return;
    }
    setStepError('');
    setStep(target);
  };

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

  return <form onSubmit={onSubmit} className="travel-card gs-member-page p-4" data-media-enabled={MEDIA_UPLOAD_ENABLED}>
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-2xl border border-gray-600 bg-gray-800/70 p-4 space-y-3">
        <p className="text-xs uppercase tracking-widest text-gray-400">Member Submission</p>
        <h2 className="text-xl font-semibold">เพิ่มข้อมูลสถานที่</h2>
        <p className="text-sm text-gray-300">กรอกเป็นขั้นตอนเพื่อให้อ่านง่ายและไม่รกเหมือนฟอร์มยาว</p>

        <div className="grid gap-2" data-testid="member-stepper">
          {([1, 2, 3] as Step[]).map((n) => (
            <button
              key={n}
              type="button"
              data-testid={`member-step-${n}`}
              aria-current={step === n ? 'step' : undefined}
              className={`rounded-xl p-3 text-left ${step === n ? 'bg-gray-900 ring-1 ring-emerald-400' : 'bg-gray-700'}`}
              onClick={() => goToStep(n)}
            >
              <span className={`text-xs ${step === n ? 'text-emerald-300' : 'text-gray-300'}`}>STEP {n}</span>
              <strong className="block">{STEP_LABELS[n].title}</strong>
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400" data-testid="member-step-status">
          ขั้นตอน {step} / 3 {step === 3 ? 'พร้อมส่ง' : 'ยังไม่ส่ง'}
        </p>
      </aside>

      <section className="rounded-2xl border border-gray-600 bg-gray-800/70 p-4 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400">STEP {step}</p>
          <h3 className="text-lg font-semibold">{STEP_LABELS[step].title}</h3>
          <p className="text-sm text-gray-300">{STEP_LABELS[step].body}</p>
        </div>

        {stepError && (
          <p className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-sm text-amber-200" data-testid="member-step-error" role="alert">
            {stepError}
          </p>
        )}

        {step === 1 && (
          <div className="space-y-4" data-testid="member-step-panel" data-step="1">
            <div className="grid md:grid-cols-2 gap-3">
              <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อสถานที่ *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input list="provinces" className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="จังหวัด *" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              <datalist id="provinces">{PROVINCES.map((p) => <option key={p} value={p} />)}</datalist>
              <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.category} onChange={(e) => handleCategoryChange(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {form.category === 'อื่นๆ' && <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ระบุหมวดหมู่" value={form.other_category || ''} onChange={(e) => setForm({ ...form, other_category: e.target.value })} />}
              <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.sub_category || ''} onChange={(e) => setForm({ ...form, sub_category: e.target.value })} disabled={!currentSubcategories.length || form.category === '-- เลือกหมวดหมู่หลัก --'}>
                <option value="">เลือกหมวดย่อย</option>
                {currentSubcategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button type="button" data-testid="member-next" className="travel-btn w-full p-3 rounded font-bold" onClick={() => goToStep(2)}>ถัดไป: ข้อมูลเพิ่มเติม</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4" data-testid="member-step-panel" data-step="2">
            <div className="rounded-2xl border border-gray-700 bg-gray-900/40 p-4 space-y-3">
              <button type="button" className="travel-btn travel-btn--secondary w-full p-3 rounded text-sm" onClick={() => setShowOptionalFields(!showOptionalFields)}>{showOptionalFields ? "ซ่อนข้อมูลเพิ่มเติม" : "ข้อมูลเพิ่มเติม (แนะนำ)"}</button>
              {showOptionalFields && <div className="grid md:grid-cols-2 gap-3">
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์ Google Maps" value={form.google_maps_url || ''} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อเล่น / nickname (ไม่บังคับ)" value={form.contributor_name || ''} onChange={(e) => setForm({ ...form, contributor_name: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="LINE display name (ไม่บังคับ)" value={form.line_display_name || ''} onChange={(e) => setForm({ ...form, line_display_name: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="อีเมล (ไม่บังคับ)" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="เบอร์โทร/ไลน์" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อผู้แนะนำ" value={form.recommender || ''} onChange={(e) => setForm({ ...form, recommender: e.target.value })} />
                <textarea className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600 md:col-span-2" placeholder="ช่องใส่ข้อแนะนำ/เหตุผล" value={form.suggestion || ''} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} />
              </div>}
            </div>

            <div className="rounded-2xl border border-gray-700 bg-gray-900/40 p-4 space-y-3">
              <h3 className="text-lg font-semibold">สื่อและคุณภาพข้อมูล</h3>
              <div className="grid md:grid-cols-2 gap-3">
                <select className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.media_type || ''} onChange={(e) => setForm({ ...form, media_type: (e.target.value || null) as any })}>
                  <option value="">ไม่มีสื่อ</option>
                  <option value="image">รูปภาพ</option>
                  <option value="video">วิดีโอ</option>
                </select>
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์รูปภาพหรือวิดีโอ (ไม่บังคับ)" value={form.media_url || ''} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
                <input className="travel-input w-full p-2 bg-gray-700 rounded border border-gray-600 md:col-span-2" placeholder="คำอธิบายสื่อ (ไม่บังคับ)" value={form.media_caption || ''} onChange={(e) => setForm({ ...form, media_caption: e.target.value })} />
              </div>

              {MEDIA_UPLOAD_ENABLED && <div className="grid grid-cols-2 gap-3">
                <label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">📸 แนบรูป<input hidden type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => attachFile(e.target.files?.[0], 'image')} /></label>
                <label className="p-2 bg-gray-700 rounded text-sm border border-gray-600 cursor-pointer">🎥 แนบ VDO<input hidden type="file" accept="video/mp4,video/webm" onChange={(e) => attachFile(e.target.files?.[0], 'video')} /></label>
              </div>}

              <select className="w-full p-2 bg-gray-700 rounded border border-gray-600" onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} value={form.rating}>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{'⭐'.repeat(r)}</option>)}</select>
            </div>

            <div className="rounded-2xl border border-gray-700 bg-gray-900/40 p-4 space-y-3">
              <h3 className="text-lg font-semibold">สิ่งอำนวยความสะดวก</h3>
              <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{AMENITIES.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.amenities.includes(a)} onChange={() => toggleCheck(a, 'amenities')} /> {a}</label>)}</div>
              <h3 className="text-lg font-semibold">ข้อควรระวัง</h3>
              <div className="grid md:grid-cols-3 grid-cols-2 gap-2 text-xs">{ALERTS.map((a) => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleCheck(a, 'alerts')} /> {a}</label>)}</div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="travel-btn flex-1 p-3 rounded" onClick={() => goToStep(1)}>ย้อนกลับ</button>
              <button type="button" data-testid="member-next" className="travel-btn flex-1 p-3 rounded font-bold" onClick={() => goToStep(3)}>ถัดไป: ตรวจสอบ</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4" data-testid="member-step-panel" data-step="3">
            <dl className="grid gap-2 rounded-2xl border border-gray-700 bg-gray-900/40 p-4 text-sm" data-testid="member-review">
              <div className="flex justify-between gap-4"><dt className="text-gray-400">ชื่อสถานที่</dt><dd>{form.name || '-'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">จังหวัด</dt><dd>{form.province || '-'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">หมวดหมู่</dt><dd>{form.category || '-'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-gray-400">คะแนน</dt><dd>{form.rating}</dd></div>
            </dl>
            <div className="flex gap-2">
              <button type="button" className="travel-btn flex-1 p-3 rounded" onClick={() => goToStep(2)}>ย้อนกลับ</button>
              <button type="submit" data-testid="member-submit" className="travel-btn flex-1 p-3 rounded font-bold">ส่งข้อมูลเข้าคิวตรวจสอบ</button>
            </div>
          </div>
        )}
      </section>
    </div>
  </form>;
}
