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


  return <div className="space-y-6 animate-fade-in">
    <div className="travel-card p-4 space-y-3">
      <div className="space-y-1"><h2 className="travel-section-title">SEARCH RESULTS</h2><p className="travel-meta text-sm">Clear travel discovery cards with stronger contrast and easier scanning.</p></div>
      <input list="search-suggestions" placeholder="🔍 ค้นหาสถานที่, หมวดหมู่, จุดเด่น..." className="travel-input w-full p-3 bg-gray-900 rounded border border-gray-600" value={filters.keyword} onChange={(e) => setFilters({...filters, keyword: e.target.value})} /><datalist id="search-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="grid md:grid-cols-3 gap-2 text-sm">
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.province} onChange={(e) => setFilters({ ...filters, province: e.target.value })}>
          <option value="">ทุกจังหวัด</option>
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value, sub_category: '' })}>
          <option value="">ทุกหมวดหมู่</option>
          {CATEGORIES.slice(1).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.sub_category} onChange={(e) => setFilters({ ...filters, sub_category: e.target.value })} disabled={!filters.category}>
          <option value="">{filters.category ? 'ทุกหมวดย่อย' : 'เลือกหมวดหมู่ก่อน'}</option>
          {subcategoryOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.amenity} onChange={(e) => setFilters({ ...filters, amenity: e.target.value })}>
          <option value="">ทุกสิ่งอำนวยความสะดวก</option>
          {AMENITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.alert} onChange={(e) => setFilters({ ...filters, alert: e.target.value })}>
          <option value="">ทุกข้อควรระวัง</option>
          {ALERTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="p-2 bg-gray-900 rounded border border-gray-600" value={filters.rating} onChange={(e) => setFilters({ ...filters, rating: Number(e.target.value) })}>
          <option value="0">ทุกดาว</option>
          {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}+ ดาว</option>)}
        </select>
      </div>
    </div>
    {warning && <div className="bg-amber-950/80 border border-amber-700 rounded-xl p-3 text-sm text-amber-100">{warning}</div>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="travel-section-title">ผลการค้นหา {places.length} รายการ</h3>
      <div className="flex gap-2">
        <span className="text-xs text-slate-300">Export: {exportScopeLabel}</span><button className="travel-btn travel-btn--success px-3 py-2 rounded text-xs disabled:opacity-50" type="button" disabled={exportRows.length === 0} onClick={exportCsv}>Export CSV</button><button className="travel-btn travel-btn--secondary px-3 py-2 rounded text-xs disabled:opacity-50" type="button" disabled={exportRows.length === 0} onClick={exportJson}>Export JSON</button>{selectedPlaces.length > 0 && <button className="travel-btn px-3 py-2 rounded text-xs" type="button" onClick={clearSelectedPlaces}>Clear selected</button>}
      </div>
    </div>
    <div className="grid md:grid-cols-2 gap-4">
      {places.map((p) => {
        const normalizedCategory = normalizeCategoryLabel(p.category || '');
        const categoryIcon = CATEGORY_ICONS[normalizedCategory] || '📍';
        const availableMedia = media[p.id || ''] || [];
        const localImage = p.local_media?.find((item) => item.media_type === 'image');
        const remoteImage = availableMedia.find((item) => item.media_type === 'image');
        const imageSource = localImage?.data_url || remoteImage?.public_url;
        const localVideo = !imageSource ? p.local_media?.find((item) => item.media_type === 'video') : undefined;
        const remoteVideo = !imageSource ? availableMedia.find((item) => item.media_type === 'video') : undefined;
        const videoLabel = localVideo?.file_name || remoteVideo?.storage_path?.split('/').pop();

        const placeKey = getPlaceKey(p, places.indexOf(p));
        return <article key={p.id || p.name} className="search-card">
          <label className="flex items-center gap-2 text-xs text-slate-200 mb-3">
            <input type="checkbox" checked={Boolean(selectedPlaceIds[placeKey])} onChange={() => toggleSelectedPlace(placeKey)} />
            Select for export
          </label>
          <div className="search-card__media">
            {imageSource ? (
              <img src={imageSource} alt={p.name} className="search-card__image" />
            ) : (localVideo || remoteVideo) ? (
              <div className="search-card__video-placeholder">
                <span>▶ Video Available</span>
                <p className="text-xs text-slate-300">{videoLabel || 'มีวิดีโอแนบ'}</p>
              </div>
            ) : (
              <div className="search-card__placeholder">
                <div className="search-card__placeholder-icon">{categoryIcon}</div>
                <div className="text-sm text-slate-300">{normalizedCategory || p.category || 'สถานที่'}</div>
              </div>
            )}
            <div className="search-card__media-top">
              <div className="search-card__category-badge">
                <span>{categoryIcon}</span>
                <span>{normalizedCategory || p.category || 'สถานที่'}</span>
              </div>
              <div className="search-card__rating-badge">⭐ {p.rating || 0}</div>
            </div>
            <div className="search-card__subcategory">{p.sub_category || 'หมวดย่อยยังไม่ระบุ'}</div>
          </div>
          <div className="search-card__body">
            <div className="search-card__main">
              <h3 className="search-card__title">{p.name}</h3>
              <p className="search-card__meta">{p.province || 'จังหวัดไม่ระบุ'}</p>
              <p className="search-card__summary">{p.suggestion || 'คำแนะนำยังไม่ระบุ'}</p>
            </div>
            <div className="search-card__info-grid">
              <div className="search-card__info-block"><span>Phone</span><p>{p.phone || '-'}</p></div>
              <div className="search-card__info-block"><span>Line</span><p>{p.line || '-'}</p></div>
              <div className="search-card__info-block"><span>Recommender</span><p>{p.recommender || '-'}</p></div>
            </div>
            {p.amenities?.length ? (
              <div className="search-card__badges">
                {p.amenities.map((a) => <span key={a} className="search-card__amenity">{a}</span>)}
              </div>
            ) : null}
            {p.alerts?.length ? (
              <div className="search-card__badges search-card__badges--alerts">
                {p.alerts.map((a) => <span key={a} className="search-card__alert">{a}</span>)}
              </div>
            ) : null}
            <div className="search-card__actions">
              <a className="travel-btn travel-btn--primary search-card__action" href={p.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.province)}`} target="_blank" rel="noreferrer">📍 Maps</a>
              <button className="travel-btn travel-btn--secondary search-card__action" type="button" onClick={() => share(p)}>🔗 Share</button>
              <button className="travel-btn travel-btn--warning search-card__action" type="button" onClick={() => onEdit(p)}>✏ Edit</button>
            </div>
          </div>
        </article>;
      })}
    </div>
  </div>;
}












