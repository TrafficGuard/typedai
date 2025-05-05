# Property types

Do not use Firestore specific types on the Service/Repository interfaces, as there will be other implementations of the interfaces with other databases.
Use `number` for date/time fields and use `Date.now()` etc. for the value


# How the Firestore emulator differs from production

The Firestore emulator attempts to faithfully replicate the behavior of the production service with some notable limitations.

- It does not implement all transaction behavior seen in production. If you're testing features that involve multiple concurrent writes to one document, the emulator may be slow to complete write requests. In some cases, locks may take up to 30 seconds to be released. Consider adjusting test timeouts accordingly, if needed.
- It does not track composite indexes and will instead execute any valid query.
- It does not enforce all limits enforced in production. For example, the emulator may allow transactions that would be rejected as too large by the production service.

Unit tests will test against the emulator. Integration test will test against a real Firestore instance to test all features and limits
