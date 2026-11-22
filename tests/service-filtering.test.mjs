import test from 'node:test';
import assert from 'node:assert/strict';

function applyLocalFilters(places, filters) {
  const keyword = (filters.keyword || '').trim().toLowerCase();
  return places.filter((p) => {
    const haystack = [p.name, p.province, p.category, p.sub_category, p.suggestion, ...(p.amenities || []), ...(p.alerts || [])].join(' ').toLowerCase();
    return (!keyword || haystack.includes(keyword)) && (!filters.province || p.province === filters.province) && (!filters.category || p.category === filters.category) && (!filters.sub_category || p.sub_category === filters.sub_category) && (!filters.rating || p.rating >= filters.rating) && (!filters.amenities?.length || filters.amenities.every((a) => p.amenities.includes(a))) && (!filters.alerts?.length || filters.alerts.every((a) => p.alerts.includes(a)));
  });
}

test('service filtering supports keyword, province, amenity, alert, and rating', () => {
  const rows = [
    { name: 'Chiang Mai Cafe', province: 'เชียงใหม่', category: 'อาหารและเครื่องดื่ม', sub_category: 'คาเฟ่', suggestion: 'wheelchair friendly', rating: 5, amenities: ['♿ รองรับรถเข็น'], alerts: [] },
    { name: 'Bangkok Park', province: 'กรุงเทพมหานคร', category: 'กิจกรรมสันทนาการ', sub_category: 'สวนสาธารณะ', suggestion: 'hot open space', rating: 3, amenities: [], alerts: ['☀️ พื้นที่โล่ง/ร้อนจัด'] },
  ];
  assert.equal(applyLocalFilters(rows, { keyword: 'cafe', province: 'เชียงใหม่', amenities: ['♿ รองรับรถเข็น'], rating: 4 }).length, 1);
  assert.equal(applyLocalFilters(rows, { alerts: ['☀️ พื้นที่โล่ง/ร้อนจัด'], rating: 4 }).length, 0);
});

test('duplicate detection is case-insensitive and excludes current record', () => {
  const rows = [{ id: '1', name: 'Sample Place' }];
  const findDuplicate = (name, excludeId) => rows.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.id !== excludeId) || null;
  assert.equal(findDuplicate(' sample place ')?.id, '1');
  assert.equal(findDuplicate('sample place', '1'), null);
});
