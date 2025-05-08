import { type DocumentData, Firestore, type QueryDocumentSnapshot } from '@google-cloud/firestore'; // Added QueryDocumentSnapshot for clarity

// Configuration
const sourceProjectId = 'tg-infra-prod'; // Replace with your source project ID
const sourceDatabaseId = 'typedai'; // Replace if using a named database
const destProjectId = 'tg-infra-prod'; // Replace with your destination project ID
const destDatabaseId = 'sophia'; // Replace if using a named database
const collectionToCopy = 'Chat'; // Replace with the collection name to copy
const batchSize = 200; // Number of documents to write in a single batch (Firestore limit is 500)

const sourceDb = new Firestore({
	projectId: sourceProjectId,
	databaseId: sourceDatabaseId,
});

const destDb = new Firestore({
	projectId: destProjectId,
	databaseId: destDatabaseId,
});

const sourceCollectionRef = sourceDb.collection(collectionToCopy);
const destCollectionRef = destDb.collection(collectionToCopy);

async function copyCollection() {
	console.log(`Starting copy of collection '${collectionToCopy}'...`);
	console.log(`Source: projects/${sourceProjectId}/databases/${sourceDatabaseId}`);
	console.log(`Destination: projects/${destProjectId}/databases/${destDatabaseId}`);

	let totalDocsCopied = 0;
	let batch = destDb.batch();
	let docsInBatch = 0;

	try {
		// Use stream() for potentially large collections
		// The stream yields QueryDocumentSnapshot objects
		const documentStream = sourceCollectionRef.stream() as AsyncIterable<QueryDocumentSnapshot<DocumentData>>; // Explicit type assertion can help TS

		for await (const docSnapshot of documentStream) {
			// REMOVED: The check 'if (!docSnapshot.exists)' is not needed here,
			// as documents from a collection stream always exist.

			const docId = docSnapshot.id;
			const docData = docSnapshot.data();

			// Add the document write operation to the batch
			const destDocRef = destCollectionRef.doc(docId);
			batch.set(destDocRef, docData);
			docsInBatch++;

			// Commit the batch when it reaches the desired size
			if (docsInBatch >= batchSize) {
				console.log(`Committing batch of ${docsInBatch} documents...`);
				await batch.commit();
				totalDocsCopied += docsInBatch;
				console.log(`Batch committed. Total copied so far: ${totalDocsCopied}`);
				// Start a new batch
				batch = destDb.batch();
				docsInBatch = 0;
			}
		}

		// Commit any remaining documents in the last batch
		if (docsInBatch > 0) {
			console.log(`Committing final batch of ${docsInBatch} documents...`);
			await batch.commit();
			totalDocsCopied += docsInBatch;
			console.log('Final batch committed.');
		}

		console.log('-----------------------------------------------------');
		console.log(`✅ Successfully copied ${totalDocsCopied} documents from '${collectionToCopy}'.`);
		console.log(`Source: projects/${sourceProjectId}/databases/${sourceDatabaseId}/documents/${collectionToCopy}`);
		console.log(`Destination: projects/${destProjectId}/databases/${destDatabaseId}/documents/${collectionToCopy}`);
		console.log('-----------------------------------------------------');
	} catch (error) {
		console.error(`❌ Error copying collection '${collectionToCopy}':`, error);
	}
}

copyCollection().catch(console.error);
