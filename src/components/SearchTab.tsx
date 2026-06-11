'use client';
import { useState } from 'react';

export default function SearchTab() {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ส่วนค้นหาและประวัติ */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700">
        <input 
          type="text" 
          placeholder="🔍 ค้นหาสถานที่, หมวดหมู่, หรือจุดเด่น..." 
          className="w-full p-3 bg-gray-900 rounded border border-gray-600 text-white focus:border-blue-500 outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="flex justify-between items-center mt-3 text-xs text-gray-400">
          <div className="flex gap-2">
            <span>ประวัติ:</span>
            <span className="bg-gray-700 px-2 py-1 rounded cursor-pointer hover:bg-gray-600">คาเฟ่เชียงใหม่</span>
            <span className="bg-gray-700 px-2 py-1 rounded cursor-pointer hover:bg-gray-600">วีลแชร์</span>
          </div>
          <div>📊 สถิติ: ค้นหาแล้ว 1,204 ครั้งวันนี้</div>
        </div>
      </div>

      {/* ส่วนแสดงผลลัพธ์หลัก */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-300">ผลการค้นหา {searchTerm && `สำหรับ "${searchTerm}"`}</h3>
        {/* Mockup Card ผลลัพธ์ */}
        <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 flex">
          <div className="w-1/3 bg-gray-700 flex items-center justify-center text-gray-500 text-xs">
            [รูปภาพสถานที่]
          </div>
          <div className="w-2/3 p-3">
            <h4 className="font-bold text-blue-400">ตัวอย่างสถานที่ A</h4>
            <p className="text-xs text-gray-400 mt-1">⭐ 5.0 | คาเฟ่ | เชียงใหม่</p>
            <div className="flex gap-1 mt-2 text-[10px]">
              <span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded">♿ รองรับรถเข็น</span>
            </div>
          </div>
        </div>
      </div>

      {/* ระบบแนะนำ (Recommendations) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
          <h4 className="text-xs font-bold text-yellow-400 mb-2">📍 สถานที่ใกล้เคียง</h4>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>- ร้านอาหาร B (ห่าง 2 กม.)</li>
            <li>- สวนสาธารณะ C (ห่าง 5 กม.)</li>
          </ul>
        </div>
        <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
          <h4 className="text-xs font-bold text-purple-400 mb-2">🔄 สถานที่ทดแทนกันได้</h4>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>- คาเฟ่ D (บรรยากาศคล้ายกัน)</li>
            <li>- รีสอร์ต E (สิ่งอำนวยความสะดวกเทียบเท่า)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}