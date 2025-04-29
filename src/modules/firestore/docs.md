# How the Firestore emulator differs from production
The Firestore emulator attempts to faithfully replicate the behavior of the production service with some notable limitations.

## Transactions
The emulator does not implement all transaction behavior seen in production. When you're testing features that involve multiple concurrent writes to one document, the emulator may be slow to complete write requests. In some cases, locks may take up to 30 seconds to be released. Consider adjusting test timeouts accordingly, if needed.

## Indexes
The emulator does not track composite indexes and will instead execute any valid query. Make sure to test your app against a real Firestore instance to determine which indexes you require.

## Limits
The emulator does not enforce all limits enforced in production. For example, the emulator may allow transactions that would be rejected as too large by the production service. Make sure you are familiar with the documented limits and that you design your app to proactively avoid them.