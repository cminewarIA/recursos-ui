# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Workspace Ownership & Verified Identity**: Every user-scoped resource under `/users/{userId}` and its subcollections (`private`, `preferences`, `speedtests`, `nodes`) requires `request.auth != null && request.auth.uid == userId` and `request.auth.token.email_verified == true` for all writes.
2. **Master Gate Parent Integrity**: No document inside `/users/{userId}/private`, `/users/{userId}/preferences`, `/users/{userId}/speedtests`, or `/users/{userId}/nodes` can exist unless the parent workspace `/users/{userId}` exists (`exists(/databases/$(database)/documents/users/$(userId))`) and belongs to `userId`.
3. **PII Isolation**: User email addresses are isolated in `/users/{userId}/private/{docId}` (`isOwner(userId)` strict `get`/`list`/`create`/`update`/`delete` access only) and never exposed in `/users/{userId}` or shared paths.
4. **Immutable Ownership & Creation Timestamps**: `uid`, `createdAt`, `testId`, and `nodeId` are immutable after document creation (`incoming().field == existing().field`). All `createdAt` (on create) and `updatedAt` (on create/update) values MUST equal `request.time`.
5. **Volumetric & Regex Boundaries**: All path IDs (`userId`, `docId`, `prefId`, `speedtestId`, `nodeId`) MUST pass `isValidId()` (`^[a-zA-Z0-9_-]+$`, `1..128` chars), and every string/number/enum property enforces strict schema keys (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update) and explicit `size()` / range limits.
6. **Secure List Queries**: No blanket `allow list: if isSignedIn()`. Every `list` rule evaluates `isOwner(userId) && existing().uid == request.auth.uid` on the queried documents without extra `get()` lookups.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Unauthenticated Workspace Read (`get` `/users/alice`)**: `auth = null` -> DENIED by `isOwner(userId)`.
2. **Cross-User Workspace Read (`get` `/users/alice` as `bob`)**: `bob` tries to read `alice`'s workspace -> DENIED by `request.auth.uid == userId`.
3. **Cross-User PII Read (`get` `/users/alice/private/account` as `bob`)**: `bob` requests `alice`'s email document -> DENIED by `isOwner(userId)`.
4. **Unverified Email Write (`create` `/users/bob` with `email_verified: false`)**: `bob` attempts write with spoofed/unverified email token -> DENIED by `isVerifiedUser()`.
5. **Identity Spoofing on Create (`create` `/users/bob/preferences/cockpit` with `uid: "alice"`)**: Authenticated `bob` sets `uid` to `"alice"` -> DENIED by `data.uid == request.auth.uid`.
6. **Shadow / Ghost Field Injection (`create` `/users/bob` with extra `"isAdmin": true`)**: Includes undeclared field -> DENIED by `data.keys().hasOnly(...)`.
7. **Shadow Key on Update (`update` `/users/bob/preferences/cockpit` changing `uid` or adding `role`)**: Attempted mutation outside `affectedKeys().hasOnly(['theme', 'locale', 'autoSync', 'updatedAt'])` -> DENIED.
8. **Client Timestamp Forgery (`create` `/users/bob/speedtests/st_1` with fake past `createdAt`)**: `createdAt != request.time` -> DENIED by Temporal Integrity invariant.
9. **ID Poisoning (`create` `/users/bob/nodes/bad$id/../../../x` or >128 chars)**: Fails `isValidId(nodeId)` regex `^[a-zA-Z0-9_-]+$` -> DENIED.
10. **Value / Denial-of-Wallet String Overflow (`create` `/users/bob/speedtests/st_2` with `serverName` of 5000 chars)**: Exceeds `maxLength: 160` -> DENIED by `isValidSpeedTestRecord`.
11. **Invalid Enum / Value Poisoning (`update` `/users/bob/preferences/cockpit` with `theme: "neon-purple"`)**: Fails `data.theme in ['light', 'dark']` -> DENIED.
12. **Orphan Subcollection Write Without Parent (`create` `/users/charlie/nodes/node_1` when `/users/charlie` does not exist)**: Fails Master Gate `exists(/databases/$(database)/documents/users/$(userId))` -> DENIED.
