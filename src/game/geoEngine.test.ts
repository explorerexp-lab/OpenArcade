import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingDegrees,
  classifyPlaceToNodeKind,
  computePathLengthMeters,
  createGeoSectorState,
  haversineMeters,
  interpolateAlongPath,
  offsetLatLng,
  stepGeoSimulation,
} from './geoEngine';

const SF_CENTER = { lat: 37.7955, lng: -122.3937 };

test('geodesic offset and haversine round-trip accurately', () => {
  const north500 = offsetLatLng(SF_CENTER, 500, 0);
  const dist = haversineMeters(SF_CENTER, north500);
  const bearing = bearingDegrees(SF_CENTER, north500);

  assert.ok(Math.abs(dist - 500) < 3, `Expected ~500m, got ${dist}`);
  assert.ok(bearing < 2 || bearing > 358, `Expected North bearing (~0°), got ${bearing}`);
});

test('interpolateAlongPath traverses multi-segment street polyline and arrives cleanly', () => {
  const p1 = offsetLatLng(SF_CENTER, 100, 90);
  const p2 = offsetLatLng(p1, 100, 0);
  const path = [SF_CENTER, p1, p2];

  const total = computePathLengthMeters(path);
  assert.ok(Math.abs(total - 200) < 3);

  const mid = interpolateAlongPath(path, 100);
  assert.equal(mid.arrived, false);
  assert.ok(haversineMeters(mid.position, p1) < 2);

  const end = interpolateAlongPath(path, 250);
  assert.equal(end.arrived, true);
  assert.equal(end.remainingMeters, 0);
  assert.ok(haversineMeters(end.position, p2) < 1);
});

test('classifyPlaceToNodeKind maps real Google Maps place types accurately', () => {
  assert.equal(classifyPlaceToNodeKind('museum', ['tourist_attraction']), 'sanctuary');
  assert.equal(classifyPlaceToNodeKind('cafe', ['food']), 'supply');
  assert.equal(classifyPlaceToNodeKind('subway_station', ['transit_station']), 'transit');
});

test('player survives opening 10 seconds with zero input because hunters spawn safely distant', () => {
  const sector = createGeoSectorState({
    sectorId: 'sf-test',
    sectorName: 'San Francisco',
    center: SF_CENTER,
  });

  for (const h of sector.hunters) {
    assert.ok(
      haversineMeters(sector.player.position, h.position) >= 280,
      `Hunter ${h.name} spawned too close`
    );
  }

  for (let i = 0; i < 220; i++) {
    const res = stepGeoSimulation(
      sector,
      { moveNorth: 0, moveEast: 0, sprint: false, triggerPulse: false },
      0.05
    );
    assert.equal(res.defeat, false);
  }
  assert.equal(sector.player.integrity, 100);
});

test('EMP pulse stuns and neutralizes nearby hunter and sets cooldown', () => {
  const sector = createGeoSectorState({
    sectorId: 'pulse-test',
    sectorName: 'Pulse Sector',
    center: SF_CENTER,
  });

  // Bring stalker inside EMP radius
  const stalker = sector.hunters[0];
  stalker.position = offsetLatLng(SF_CENTER, 90, 45);
  stalker.hp = 1;

  const { events } = stepGeoSimulation(
    sector,
    { moveNorth: 0, moveEast: 0, sprint: false, triggerPulse: true },
    0.05
  );

  assert.equal(stalker.defeated, true);
  assert.equal(sector.player.huntersNeutralized, 1);
  assert.ok(sector.player.pulseCooldown > 0);
  assert.ok(events.some((e) => e.type === 'hunter_neutralized'));
});

test('warden charges telegraphed blast and damages player if not evaded (loss reachability)', () => {
  const sector = createGeoSectorState({
    sectorId: 'warden-test',
    sectorName: 'Warden Sector',
    center: SF_CENTER,
  });

  const warden = sector.hunters.find((h) => h.archetype === 'warden')!;
  warden.position = offsetLatLng(SF_CENTER, 60, 0);
  warden.attackCooldown = 0;
  sector.player.integrity = 20;

  let sawTelegraph = false;
  let defeated = false;
  for (let i = 0; i < 60; i++) {
    const res = stepGeoSimulation(
      sector,
      { moveNorth: 0, moveEast: 0, sprint: false, triggerPulse: false },
      0.05
    );
    if (warden.telegraphTimer > 0) sawTelegraph = true;
    if (res.defeat) {
      defeated = true;
      break;
    }
  }

  assert.equal(sawTelegraph, true, 'Warden must show telegraph before firing');
  assert.equal(defeated, true, 'Defeat state must be reachable when integrity hits 0');
});
