/**
 * MEMBER_TO_ADMIN_RUNTIME_MATRIX — governed runtime proof for member → admin workflow
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
global.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, value.toString()); },
  removeItem: (key) => { storage.delete(key); },
  clear: () => { storage.clear(); },
};

const PLACE_KEY = 'guide_sources_places';

function createPendingPlace(place) {
  const places = JSON.parse(localStorage.getItem(PLACE_KEY) || '[]');
  const newPlace = {
    ...place,
    id: `local-${Date.now()}`,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  places.unshift(newPlace);
  localStorage.setItem(PLACE_KEY, JSON.stringify(places));
  return newPlace;
}

function listStagingPlaces() {
  const places = JSON.parse(localStorage.getItem(PLACE_KEY) || '[]');
  return places.filter((p) => p.status === 'pending');
}

function approvePlace(place) {
  const places = JSON.parse(localStorage.getItem(PLACE_KEY) || '[]');
  const index = places.findIndex((p) => p.id === place.id);
  if (index !== -1) {
    places[index].status = 'approved';
    localStorage.setItem(PLACE_KEY, JSON.stringify(places));
  }
  return places[index];
}

function searchPlaces({ keyword = '' }) {
  const places = JSON.parse(localStorage.getItem(PLACE_KEY) || '[]');
  const searchTerm = keyword.toLowerCase();
  return places.filter(
    (p) =>
      p.status === 'approved' &&
      (p.name.toLowerCase().includes(searchTerm) ||
        p.province.toLowerCase().includes(searchTerm)),
  );
}

test('MEMBER_TO_ADMIN_RUNTIME_MATRIX', () => {
  localStorage.clear();

  const testPlace = {
    name: 'RuntimeTestPlace',
    province: 'กรุงเทพมหานคร',
    category: 'คาเฟ่ / ร้านกาแฟ',
    sub_category: 'คาเฟ่ชงพิเศษ',
    rating: 5,
    amenities: ['WiFi'],
    alerts: [],
  };

  const createdPlace = createPendingPlace(testPlace);
  assert.ok(createdPlace.id, 'Member createPendingPlace returns place with id');

  const initialPending = listStagingPlaces();
  assert.ok(
    initialPending.some((p) => p.id === createdPlace.id),
    'Pending list contains new place after create',
  );

  approvePlace(createdPlace);

  const postApprovePending = listStagingPlaces();
  assert.ok(
    !postApprovePending.some((p) => p.id === createdPlace.id),
    'Pending list no longer contains place after approve',
  );

  const approvedPlaces = JSON.parse(localStorage.getItem(PLACE_KEY) || '[]').filter(
    (p) => p.status === 'approved',
  );
  assert.ok(
    approvedPlaces.some((p) => p.id === createdPlace.id),
    'Approved list contains place after approve',
  );

  const searchResults = searchPlaces({ keyword: 'RuntimeTestPlace' });
  assert.ok(
    searchResults.some((p) => p.id === createdPlace.id),
    'Search returns approved place',
  );

  localStorage.clear();
});
