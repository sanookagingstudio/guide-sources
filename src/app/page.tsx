'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import SearchTab, { type SearchPlace } from '@/components/SearchTab';
import AdminTab from '@/components/AdminTab';

// ข้อมูลอ้างอิงมาตรฐานที่คุณต้องการให้คงไว้ทั้งหมด
const PROVINCES = ['กรุงเทพมหานคร', 'เชียงใหม่', 'ลำปาง', 'ลำพูน', 'เชียงราย', 'แม่ฮ่องสอน', 'พะเยา', 'แพร่', 'น่าน', 'ตาก', 'สุโขทัย', 'อุตรดิตถ์', 'พิษณุโลก', 'พิจิตร', 'กำแพงเพชร', 'เพชรบูรณ์', 'นครสวรรค์', 'อุทัยธานี', 'กาญจนบุรี', 'ราชบุรี', 'สุพรรณบุรี', 'นครปฐม', 'สมุทรสาคร', 'สมุทรสงคราม', 'เพชรบุรี', 'ประจวบคีรีขันธ์', 'ชลบุรี', 'ระยอง', 'จันทบุรี', 'ตราด', 'ฉะเชิงเทรา', 'ปราจีนบุรี', 'นครนายก', 'สระแก้ว', 'นครราชสีมา', 'บุรีรัมย์', 'สุรินทร์', 'ศรีสะเกษ', 'อุบลราชธานี', 'ยโสธร', 'ชัยภูมิ', 'อำนาจเจริญ', 'บึงกาฬ', 'หนองคาย', 'เลย', 'อุดรธานี', 'นครพนม', 'สกลนคร', 'มุกดาหาร', 'กาฬสินธุ์', 'มหาสารคาม', 'ร้อยเอ็ด', 'หนองบัวลำภู', 'ขอนแก่น', 'ชุมพร', 'ระนอง', 'สุราษฎร์ธานี', 'พังงา', 'ภูเก็ต', 'กระบี่', 'นครศรีธรรมราช', 'ตรัง', 'พัทลุง', 'สตูล', 'สงขลา', 'ปัตตานี', 'ยะลา', 'นราธิวาส'];
const CATEGORIES = ['อาหารและเครื่องดื่ม', 'ที่พักและรีสอร์ต', 'แหล่งท่องเที่ยวเชิงสุขภาพ', 'กิจกรรมสันทนาการ', 'ศูนย์บำบัดและดูแลผู้สูงอายุ', 'การเรียนรู้และเวิร์กชอป', 'รถเช่าบริการพิเศษ', 'อื่นๆ (โปรดระบุ)'];
const AMENITIES = ['♿ รองรับรถเข็น', '🚌 จอดรถบัสได้', '⏳ ทางเรียบ/ราวจับ', '🐾 ห้องน้ำคนพิการ', '🏥 มีเครื่อง AED', '📶 Wi-Fi ฟรี', '🦮 รองรับผู้พิการทางสายตา'];
const ALERTS = ['🚗 จอดรถยาก', '⏳ คิวยาว', '📞 ต้องสำรองล่วงหน้า', '📐 บันไดเยอะ', '📶 สัญญาณโทรศัพท์ไม่ดี', '☀️ พื้นที่โล่ง/ร้อนจัด'];

export default function GuideSourcesApp() {
  const [activeTab, setActiveTab] = useState<'search' | 'member' | 'admin'>('member');
  const [rating, setRating] = useState(5);
  // เพิ่ม id ใน state เพื่อใช้ระบุตอนกดแก้ไข
  const [form, setForm] = useState({
    id: '', name: '', province: '', category: CATEGORIES[0], other_cat: '', sub_cat: '',
    map_url: '', phone: '', recommender: '', suggestion: '', amenities: [] as string[], alerts: [] as string[]
  });

  const handleEdit = (place: SearchPlace) => {
    setForm({
      id: place.id, // เก็บ ID ไว้
      name: place.name || '',
      province: place.province || '',
      category: place.category || CATEGORIES[0],
      other_cat: place.raw_data?.other_category || '',
      sub_cat: place.raw_data?.sub_category || '',
      map_url: place.raw_data?.google_maps_url || '',
      phone: place.raw_data?.phone || '',
      recommender: place.raw_data?.recommender || '',
      suggestion: place.raw_data?.suggestion || '',
      amenities: place.raw_data?.amenities || [],
      alerts: place.alerts || []
    });
    setActiveTab('member');
    alert(`กำลังแก้ไข: ${place.name}`);
  };

  const handleRatingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRating(Number(e.target.value));
  };

  const handleFileAttach = (type: string) => {
    alert(`ระบบแนบ ${type} พร้อมทำงาน`);
  };

  const toggleCheck = (item: string, field: 'amenities' | 'alerts') => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].includes(item) ? prev[field].filter(i => i !== item) : [...prev[field], item]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawData = {
      other_category: form.other_cat,
      sub_category: form.sub_cat,
      google_maps_url: form.map_url,
      phone: form.phone,
      recommender: form.recommender,
      suggestion: form.suggestion,
      rating: Number(rating),
      amenities: form.amenities
    };

    const dataToUpsert = {
      name: form.name || '',
      province: form.province || '',
      category: form.category || '',
      alerts: form.alerts,
      status: 'pending',
      raw_data: rawData
    };

    try {
      if (form.id) {
        // อัปเดตข้อมูลเดิมที่มี ID อยู่แล้ว
        const { error } = await supabase.from('staging_places').update(dataToUpsert).eq('id', form.id);
        if (error) throw error;
        alert("แก้ไขข้อมูลเรียบร้อย!");
      } else {
        // เพิ่มข้อมูลใหม่
        const { error } = await supabase.from('staging_places').insert([dataToUpsert]);
        if (error) throw error;
        alert("บันทึกข้อมูลใหม่เรียบร้อย!");
      }
      setForm({ id: '', name: '', province: '', category: CATEGORIES[0], other_cat: '', sub_cat: '', map_url: '', phone: '', recommender: '', suggestion: '', amenities: [], alerts: [] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "โปรดดู console";
      alert("เกิดข้อผิดพลาด: " + message);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-gray-900 text-white min-h-screen">
      <nav className="flex bg-gray-800 p-2 rounded-lg mb-4">
        <button onClick={() => setActiveTab('search')} className={`flex-1 p-2 rounded ${activeTab === 'search' ? 'bg-blue-600' : ''}`}>🔍 ค้นหา</button>
        <button onClick={() => setActiveTab('member')} className={`flex-1 p-2 rounded ${activeTab === 'member' ? 'bg-blue-600' : ''}`}>👤 Member</button>
        <button onClick={() => setActiveTab('admin')} className={`flex-1 p-2 rounded ${activeTab === 'admin' ? 'bg-blue-600' : ''}`}>⚙️ Admin</button>
      </nav>

      {activeTab === 'search' && <SearchTab onEdit={handleEdit} />}

      {activeTab === 'member' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อสถานที่" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          <div className="flex gap-2">
            <input list="provinces" className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="จังหวัด" value={form.province} onChange={e => setForm({...form, province: e.target.value})} />
            <datalist id="provinces">{PROVINCES.map(p => <option key={p} value={p} />)}</datalist>
            <select className="w-full p-2 bg-gray-700 rounded border border-gray-600" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {form.category === 'อื่นๆ (โปรดระบุ)' && <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ระบุหมวดหมู่" value={form.other_cat} onChange={e => setForm({...form, other_cat: e.target.value})} />}
          <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="หมวดหมู่ย่อย" value={form.sub_cat} onChange={e => setForm({...form, sub_cat: e.target.value})} />
          <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ลิงก์ Google Maps" value={form.map_url} onChange={e => setForm({...form, map_url: e.target.value})} />
          <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="เบอร์โทร/ไลน์" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
          <input className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ชื่อผู้แนะนำ" value={form.recommender} onChange={e => setForm({...form, recommender: e.target.value})} />
          <textarea className="w-full p-2 bg-gray-700 rounded border border-gray-600" placeholder="ช่องใส่ข้อแนะนำ/เหตุผล" value={form.suggestion} onChange={e => setForm({...form, suggestion: e.target.value})} />
          
          <div className="flex gap-2">
            <button type="button" onClick={() => handleFileAttach('รูป')} className="flex-1 p-2 bg-gray-700 rounded text-sm border border-gray-600">📸 แนบรูป</button>
            <button type="button" onClick={() => handleFileAttach('VDO')} className="flex-1 p-2 bg-gray-700 rounded text-sm border border-gray-600">🎥 แนบ VDO</button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm">Rating (ดาว):</span>
            <select className="w-full p-2 bg-gray-700 rounded border border-gray-600" onChange={handleRatingChange} value={rating}>
              <option value="5">⭐⭐⭐⭐⭐</option><option value="4">⭐⭐⭐⭐</option><option value="3">⭐⭐⭐</option><option value="2">⭐⭐</option><option value="1">⭐</option>
            </select>
          </div>

          <div className="text-xs font-bold text-gray-400">สิ่งอำนวยความสะดวก:</div>
          <div className="grid grid-cols-2 gap-2 text-xs">{AMENITIES.map(a => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.amenities.includes(a)} onChange={() => toggleCheck(a, 'amenities')} /> {a}</label>)}</div>
          <div className="text-xs font-bold text-gray-400">ข้อควรระวัง:</div>
          <div className="grid grid-cols-2 gap-2 text-xs">{ALERTS.map(a => <label key={a} className="flex gap-1"><input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleCheck(a, 'alerts')} /> {a}</label>)}</div>
          
          <button type="submit" className="w-full p-3 bg-blue-600 rounded font-bold hover:bg-blue-700">🚀 {form.id ? 'บันทึกการแก้ไข' : 'บันทึกเข้าคลัง'}</button>
        </form>
      )}

      {activeTab === 'admin' && <AdminTab />}
    </div>
  );
}