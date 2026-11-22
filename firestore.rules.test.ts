import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security rules structural, Dirty Dozen, Red-Team hardening & repository secret hygiene audit.
 */
const rulesPath = fs.existsSync('firestore.rules') ? 'firestore.rules' : 'DRAFT_firestore.rules';
const rulesText = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));
const gitignore = fs.readFileSync('.gitignore', 'utf8');

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

test('Dirty Dozen 1-5: PII isolation, verified email, email binding, role immutability, and strict keys', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rulesText, /data\.email\s*==\s*request\.auth\.token\.email/);
  assert.match(rulesText, /incoming\(\)\.email\s*==\s*existing\(\)\.email/);
  assert.match(rulesText, /data\.role\s+is\s+string\s+&&\s+data\.role\s*==\s*'player'/);
  assert.match(rulesText, /incoming\(\)\.role\s*==\s*existing\(\)\.role/);
  assert.match(rulesText, /data\.keys\(\)\.hasOnly\(\['uid',\s*'callsign',\s*'email',\s*'role',\s*'createdAt',\s*'updatedAt'\]\)/);
  assert.match(rulesText, /match \/users\/\{userId\}[\s\S]*?allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
});

test('Dirty Dozen 6-9: Owner binding, hp<=maxHp invariant, server timestamps, bounded embedding arrays, and ID regex', () => {
  assert.match(rulesText, /data\.hp <= data\.maxHp/);
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

test('Red-Team hardening: Admin registry read-only, no realm list scraping, owner-only realm updates', () => {
  assert.match(rulesText, /match \/admins\/\{adminId\}[\s\S]*?allow write: if false;/);
  assert.match(rulesText, /match \/realms\/\{realmId\}[\s\S]*?allow list: if isAdmin\(\);/);
  assert.doesNotMatch(rulesText, /Tier 2: Connected Wayfarer/);
  assert.match(rulesText, /match \/beacons\/\{beaconId\}[\s\S]*?beaconId\.size\(\) <= 64/);
});

test('GitHub secret hygiene: .gitignore excludes config/env/keys and source files hold zero literal secrets', () => {
  for (const pattern of ['.env', 'firebase-applet-config.json', '*.pem', '*.key', '.gmp_cache/']) {
    assert.ok(gitignore.includes(pattern), `Missing .gitignore rule for ${pattern}`);
  }

  const secretRegex = /(AIza[0-9A-Za-z_-]{30,}|sk-[0-9A-Za-z]{20,}|ghp_[0-9A-Za-z]{20,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/;
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.aistudio', '.gmp_cache', '.playwright-cli'].includes(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full));
      } else if (entry.name !== 'firebase-applet-config.json') {
        out.push(full);
      }
    }
    return out;
  };

  for (const file of walk('.')) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(secretRegex.test(content), false, `Potential literal secret found in ${file}`);
  }
});
