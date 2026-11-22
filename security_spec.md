# Security Specification — Aethern: Echoes of the Living Atlas

## 1. Data Invariants

1. **PII Isolation**: `/users/{userId}` holds email PII and is strictly readable/writable ONLY by `request.auth.uid == userId` with `request.auth.token.email_verified == true` (or admin). No blanket reads exist.
2. **No Self-Assigned Privilege Escalation**: `UserProfile.role` must strictly be `'player'` on create and immutable on update.
3. **Owner-Bound Subcollections**: `/users/{userId}/saves/{saveId}` and `/users/{userId}/memories/{memoryId}` enforce Master Gate parent existence (`exists(/databases/$(database)/documents/users/$(userId))`) and `ownerId == request.auth.uid == userId`.
4. **Vector Bounds**: `VectorMemoryRecord.embedding` is strictly bounded to length `<= 64`, non-empty, with numeric first element validation.
5. **Multiplayer Presence Integrity**: `/realms/{realmId}/players/{playerId}` requires parent `/realms/{realmId}` to exist, enforces `playerId == request.auth.uid` and `incoming().uid == request.auth.uid`, and forbids spoofing another player's coordinates.
6. **Beacon Immutability & Author Binding**: `/realms/{realmId}/beacons/{beaconId}` verifies parent realm exists, binds `authorId == request.auth.uid`, forbids client updates, and allows deletion only by the author or admin.
7. **Temporal Integrity**: All `createdAt` (on create) and `updatedAt` (on create/update) fields must equal `request.time`.
8. **ID Poisoning Guard**: Every single-document target checks `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Fail with PERMISSION_DENIED)

1. **Unauthenticated Read of Private Profile**: `GET /users/alice` with `auth == null`.
2. **Cross-User PII Access**: `GET /users/alice` signed in as `bob`.
3. **Self-Assigned Admin Role**: `CREATE /users/bob` with `{ role: "admin", ... }`.
4. **Shadow Ghost Field Injection**: `CREATE /users/bob` with extra key `isVerified: true`.
5. **Unverified Email Write**: `CREATE /users/bob` with `auth.token.email_verified == false`.
6. **Cross-User Save Overwrite**: `UPDATE /users/alice/saves/slot-1` signed in as `bob`.
7. **Client-Forged Timestamp**: `CREATE /users/bob/saves/slot-1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
8. **Vector Array Overflow (Denial of Wallet)**: `CREATE /users/bob/memories/mem-1` with 500-element `embedding` array.
9. **Path Variable ID Poisoning**: `CREATE /realms/../../evil$id!` with invalid characters.
10. **Multiplayer Presence Spoofing**: `CREATE /realms/sanctuary-prime/players/alice` signed in as `bob`.
11. **Orphaned Beacon Write**: `CREATE /realms/nonexistent-realm/beacons/b1` where parent realm does not exist.
12. **Beacon Content Tampering**: `UPDATE /realms/sanctuary-prime/beacons/b1` attempting to modify another user's beacon message.
