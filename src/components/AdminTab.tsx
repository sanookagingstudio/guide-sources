'use client';
import { useState } from 'react';

export default function AdminTab() {
  const [aiProvider, setAiProvider] = useState('jarvis-gpt4o');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Agnostic Provider Selector (OpenRouter Style) */}
      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-white text-sm">🧠 สมองส่วนกลาง (AI Routing)</h3>
          <p className="text-xs text-gray-400">เลือก Provider ที่คุ้มค่า/ฉลาดที่สุด ณ เวลานี้</p>
        </div>
        <select 
          className="bg-gray-900 border border-gray-600 rounded p-2 text-xs text-white outline-none"
          value={aiProvider}
          onChange={(e) => setAiProvider(e.target.value)}
        >
          <option value="jarvis-gpt4o">Jarvis (GPT-4o) - ฉลาดสุด</option>
          <option value="sentinel-claude">Sentinel (Claude 3.5) - วิเคราะห์แม่นยำ</option>
          <option value="foresight-gemini">Foresight (Gemini 1.5) - ดึงข้อมูลเร็ว</option>
        </select>
      </div>

      {/* AI Insights & Statistics Dashboard */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-900/30 border border-blue-800 p-3 rounded-lg">
          <h4 className="text-xs font-bold text-blue-400 mb-2">📈 เทรนด์จาก Foresight</h4>
          <div className="h-16 flex items-end gap-1">
            {/* กราฟจำลอง */}
            <div className="w-1/4 bg-blue-500 h-1/2 rounded-t"></div>
            <div className="w-1/4 bg-blue-500 h-3/4 rounded-t"></div>
            <div className="w-1/4 bg-blue-500 h-full rounded-t"></div>
            <div className="w-1/4 bg-blue-500 h-2/3 rounded-t"></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">คนค้นหาสถานที่รองรับวีลแชร์เพิ่มขึ้น 45% สัปดาห์นี้</p>
        </div>
        
        <div className="bg-purple-900/30 border border-purple-800 p-3 rounded-lg">
          <h4 className="text-xs font-bold text-purple-400 mb-2">⚡ Jarvis Alert</h4>
          <ul className="text-[10px] text-gray-300 space-y-2">
            <li className="flex gap-2"><span className="text-red-400">⚠️</span> พบ 5 สถานที่รออนุมัติ</li>
            <li className="flex gap-2"><span className="text-green-400">💡</span> แนะนำให้เพิ่มหมวดหมู่ &quot;เที่ยวหน้าฝน&quot;</li>
          </ul>
        </div>
      </div>

      {/* Data Management (ปุ่มจัดการหลังบ้านโดยไม่แก้โค้ด) */}
      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
        <h3 className="font-bold text-sm text-white mb-3">🛠️ เครื่องมือจัดการเนื้อหา</h3>
        <div className="flex gap-2 flex-wrap">
          <button className="bg-green-700 hover:bg-green-600 px-3 py-1.5 rounded text-xs">✅ อนุมัติสถานที่ (5)</button>
          <button className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs border border-gray-600">✏️ แก้ไขตัวเลือก Dropdown</button>
          <button className="bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded text-xs">🔗 ดึงข่าวสาร (API เว็บหลัก)</button>
        </div>
      </div>
    </div>
  );
}