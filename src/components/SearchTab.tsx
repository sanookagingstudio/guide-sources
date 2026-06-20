'use client';
import { useEffect, useMemo, useState } from 'react';
import { ALERTS, AMENITIES, CATEGORIES, PROVINCES, SUBCATEGORIES, CATEGORY_ICONS, getSubcategoriesForCategory, normalizeCategoryLabel } from '@/lib/constants';
import { listApprovedPlaces, type PlaceRecord } from '@/services/placesService';
import { listPlaceMedia, type PlaceMedia } from '@/services/mediaService';

export default function SearchTab({ refreshKey, onEdit }: { refreshKey: number; onEdit: (place: PlaceRecord) => void }) {
  const [places, setPlaces] = useState<PlaceRecord[]>([]);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Record<string, boolean>>({});
  const [media, setMedia] = useState<Record<string, PlaceMedia[]>>({});
  const [warning, setWarning] = useState('');
  const [filters, setFilters] = useState({ keyword: '', province: '', category: '', sub_category: '', amenity: '', alert: '', rating: 0 });

  const loadPlaces = async () => {
    try {
      setWarning('');
      const rows = await listApprovedPlaces({ keyword: filters.keyword, province: filters.province, category: filters.category, sub_category: filters.sub_category, amenities: filters.amenity ? [filters.amenity] : [], alerts: filters.alert ? [filters.alert] : [], rating: filters.rating || undefined }, { onWarning: setWarning });
      setPlaces(rows);
      try {
        const pairs = await Promise.all(rows.filter((p) => p.id).map(async (p) => [p.id!, await listPlaceMedia(p.id!)] as const).slice(0, 20));
        setMedia(Object.fromEntries(pairs));
      } catch {
        setMedia({});
      }
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'ไม่สามารถโหลดข้อมูลค้นหาได้ในตอนนี้ แต่จะใช้ข้อมูลในเบราว์เซอร์แทน');
      setPlaces([]);
    }
  };

  useEffect(() => { void loadPlaces(); }, [filters, refreshKey]);
  useEffect(() => {
    const onRefresh = () => { void loadPlaces(); };
    window.addEventListener('guide-sources-updated', onRefresh);
    window.addEventListener('guide-sources:refresh', onRefresh);
    return () => {
      window.removeEventListener('guide-sources-updated', onRefresh);
      window.removeEventListener('guide-sources:refresh', onRefresh);
    };
  }, [filters, refreshKey]);
  const suggestions = useMemo(() => [...new Set(places.flatMap((p) => [p.name, p.province, p.category, p.sub_category].filter(Boolean) as string[]))], [places]);
  const subcategoryOptions = useMemo(() => (filters.category ? getSubcategoriesForCategory(filters.category) : SUBCATEGORIES), [filters.category]);
  const share = async (p: PlaceRecord) => { const text = `${p.name} (${p.province}) ${p.google_maps_url || ''}`; await navigator.clipboard?.writeText(text); alert('คัดลอกข้อมูลสำหรับแชร์แล้ว'); };
  const getPlaceKey = (place: PlaceRecord, index: number) => place.id || `${place.name}-${place.province}-${index}`;

  const selectedPlaces = useMemo(
    () => places.filter((place, index) => selectedPlaceIds[getPlaceKey(place, index)]),
    [places, selectedPlaceIds]
  );

  const exportRows = selectedPlaces.length ? selectedPlaces : places;
  const exportScopeLabel = selectedPlaces.length ? `selected ${selectedPlaces.length}` : `all ${places.length}`;

  const toggleSelectedPlace = (key: string) => {
    setSelectedPlaceIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const clearSelectedPlaces = () => setSelectedPlaceIds({});

  const exportCsv = () => {
    const headers = [
      'name',
      'province',
      'category',
      'sub_category',
      'rating',
      'google_maps_url',
      'phone',
      'recommender',
      'suggestion',
      'media_type',
      'media_url',
      'media_caption'
    ];

    const escapeCsv = (value: unknown) => {
      const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const csv = [
      headers.join(','),
      ...exportRows.map((place) =>
        headers.map((key) => escapeCsv((place as Record<string, unknown>)[key])).join(',')
      )
    ].join('\r\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guide-sources-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportRows, null, 2)], {
      type: 'application/json;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guide-sources-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };


  return <div className="search-tab-container animate-fade-in">
    {/* Header Area */}
    <div className="search-header">
      <div className="header-text">
        <h1 className="travel-section-title">ค้นหาสถานที่เที่ยว</h1>
        <p className="travel-meta">ค้นหาสถานที่เที่ยวที่คุณสนใจได้ที่นี่</p>
      </div>
      
      <div className="search-bar">
        <input 
          list="search-suggestions" 
          placeholder="🔍 ค้นหาสถานที่, หมวดหมู่, จุดเด่น..." 
          className="search-input" 
          value={filters.keyword} 
          onChange={(e) => setFilters({...filters, keyword: e.target.value})} 
        />
        <datalist id="search-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        <button className="search-button travel-btn travel-btn--primary">ค้นหา</button>
      </div>
      
      <div className="quick-filters">
        <button onClick={() => setFilters({...filters, category: 'ร้านอาหาร'})}>ร้านอาหาร</button>
        <button onClick={() => setFilters({...filters, category: 'ที่พัก'})}>ที่พัก</button>
        <button onClick={() => setFilters({...filters, category: 'สถานที่เที่ยว'})}>สถานที่เที่ยว</button>
        <button onClick={() => setFilters({...filters, rating: 4})}>ยอดนิยม</button>
      </div>
    </div>

    {/* Main Content Area */}
    <div className="search-content">
      {/* Filter Sidebar */}
      <div className="filter-sidebar">
        <h3>ตัวกรอง</h3>
        
        <div className="filter-group">
          <label>จังหวัด</label>
          <select value={filters.province} onChange={(e) => setFilters({ ...filters, province: e.target.value })}>
            <option value="">ทุกจังหวัด</option>
            {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        
        <div className="filter-group">
          <label>หมวดหมู่</label>
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value, sub_category: '' })}>
            <option value="">ทุกหมวดหมู่</option>
            {CATEGORIES.slice(1).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        
        <div className="filter-group">
          <label>ประเภท</label>
          <select value={filters.sub_category} onChange={(e) => setFilters({ ...filters, sub_category: e.target.value })} disabled={!filters.category}>
            <option value="">{filters.category ? 'ทุกหมวดย่อย' : 'เลือกหมวดหมู่ก่อน'}</option>
            {subcategoryOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        
        <div className="filter-group">
          <label>ช่วงราคา</label>
          <select>
            <option value="">ทั้งหมด</option>
            <option value="low">ต่ำ (น้อยกว่า 100 บาท)</option>
            <option value="medium">กลาง (100-300 บาท)</option>
            <option value="high">สูง (มากกว่า 300 บาท)</option>
          </select>
        </div>
        
        <div className="filter-group">
          <label>คะแนนแนะนำ</label>
          <select value={filters.rating} onChange={(e) => setFilters({ ...filters, rating: Number(e.target.value) })}>
            <option value="0">ทุกคะแนน</option>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ดาวขึ้นไป</option>)}
          </select>
        </div>
        
        <div className="filter-buttons">
          <button className="travel-btn" onClick={() => setFilters({ keyword: '', province: '', category: '', sub_category: '', amenity: '', alert: '', rating: 0 })}>ล้างตัวกรอง</button>
          <button className="travel-btn travel-btn--primary">ใช้ตัวกรอง</button>
        </div>
      </div>

      {/* Results Area */}
      <div className="results-area">
        {warning && <div className="search-warning">{warning}</div>}
        
        <div className="results-header">
          <h3>ผลการค้นหา {places.length} รายการ</h3>
          <div className="export-actions">
            <button className="travel-btn travel-btn--success" disabled={exportRows.length === 0} onClick={exportCsv}>CSV</button>
            <button className="travel-btn travel-btn--secondary" disabled={exportRows.length === 0} onClick={exportJson}>JSON</button>
            {selectedPlaces.length > 0 && <button className="travel-btn" onClick={clearSelectedPlaces}>Clear</button>}
          </div>
        </div>
        
        <div className="results-list">
          {places.length === 0 ? (
            <div className="empty-state">
              <p>ไม่พบผลลัพธ์ที่ตรงกับการค้นหาของคุณ</p>
              <button className="travel-btn" onClick={() => setFilters({ keyword: '', province: '', category: '', sub_category: '', amenity: '', alert: '', rating: 0 })}>ล้างตัวกรอง</button>
            </div>
          ) : (
            places.map((p) => {
              const normalizedCategory = normalizeCategoryLabel(p.category || '');
              const categoryIcon = CATEGORY_ICONS[normalizedCategory] || '📍';
              const availableMedia = media[p.id || ''] || [];
              const localImage = p.local_media?.find((item) => item.media_type === 'image');
              const remoteImage = availableMedia.find((item) => item.media_type === 'image');
              const imageSource = localImage?.data_url || remoteImage?.public_url;
              
              const placeKey = getPlaceKey(p, places.indexOf(p));
              return (
                <article key={p.id || p.name} className="result-card">
                  <div className="card-image">
                    {imageSource ? (
                      <img src={imageSource} alt={p.name} />
                    ) : (
                      <div className="image-placeholder">
                        <span>{categoryIcon}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="card-content">
                    <div className="card-header">
                      <h3>{p.name}</h3>
                      <span className="card-province">{p.province || 'จังหวัดไม่ระบุ'}</span>
                    </div>
                    
                    <p className="card-description">{p.suggestion || 'คำแนะนำยังไม่ระบุ'}</p>
                    
                    <div className="card-badges">
                      <span className="category-badge">{normalizedCategory || p.category || 'สถานที่'}</span>
                      {p.sub_category && <span className="subcategory-badge">{p.sub_category}</span>}
                      <span className="rating-badge">⭐ {p.rating || 0}</span>
                    </div>
                    
                    <div className="card-actions">
                      <a className="travel-btn" href={p.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.province)}`} target="_blank" rel="noreferrer">ดูแผนที่</a>
                      <button className="travel-btn travel-btn--secondary" onClick={() => share(p)}>แชร์</button>
                    </div>
                  </div>
                  
                  <label className="select-export">
                    <input type="checkbox" checked={Boolean(selectedPlaceIds[placeKey])} onChange={() => toggleSelectedPlace(placeKey)} />
                    <span>เลือก</span>
                  </label>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  </div>;
}













