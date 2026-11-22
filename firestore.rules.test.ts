import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Security rules structural & Dirty Dozen invariant audit runner.
 * Verifies every collection in firebase-blueprint.json is protected in firestore.rules
 * and validates the Eight Pillars security gates against the Dirty Dozen threat matrix.
 */
const rulesPath = fs.existsSync('firestore.rules') ? 'firestore.rules' : 'DRAFT_firestore.rules';
const rulesText = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

test('Global safety net default-deny catch-all is present', () => {
  assert.match(rulesText, /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('Every blueprint collection has an explicit match block in rules', () => {
  const paths = Object.keys(blueprint.firestore);
  assert.ok(paths.length >= 6);
  for (const p of paths) {
    const leaf = p.split('/').slice(-2).join('/');
    assert.ok(rulesText.includes(leaf), `Missing match block for ${p} (${leaf})`);
  }
});

test('Dirty Dozen 1-5: PII isolation, verified email, role immutability, and strict keys', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rulesText, /data\.role\s+is\s+string\s+&&\s+data\.role\s*==\s*'player'/);
  assert.match(rulesText, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);
  assert.match(rulesText, /data\.keys\(\)\.hasOnly\(\['uid',\s*'callsign',\s*'email',\s*'role',\s*'createdAt',\s*'updatedAt'\]\)/);
  assert.match(rulesText, /match \/users\/\{userId\}[\s\S]*?allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
});

test('Dirty Dozen 6-9: Owner binding, server timestamps, bounded embedding arrays, and ID regex', () => {
  assert.match(rulesText, /data\.embedding is list && data\.embedding\.size\(\) >= 1 && data\.embedding\.size\(\) <= 64 && data\.embedding\[0\] is number/);
  assert.match(rulesText, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesText, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesText, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
});

test('Dirty Dozen 10-12: Master Gate parent exists, presence UID binding, immutable beacons', () => {
  assert.match(rulesText, /exists\(\/databases\/\$\(database\)\/documents\/realms\/\$\(realmId\)\)/);
  assert.match(rulesText, /data\.uid == playerId && data\.uid == request\.auth\.uid/);
  assert.match(rulesText, /match \/beacons\/\{beaconId\}[\s\S]*?allow update: if false;/);
});
