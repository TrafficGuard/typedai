/**
 * Registers uncaughtException and unhandledRejection event handlers for Node.js applications.
 * @param terminateOnError
 */
export function registerErrorHandlers(terminateOnError = false) {
	// 1. Uncaught Exception Handler
	process.on('uncaughtException', (err, origin) => {
		console.error('------------------------------------');
		console.error('UNCAUGHT EXCEPTION!');
		console.error('Error:', err);
		console.error('Origin:', origin);
		console.error('Stack:', err.stack);
		console.error('------------------------------------');
		// It's generally recommended to exit gracefully after an uncaught exception,
		// as the application state might be corrupted.
		// Consider a small delay to allow any pending I/O (like logging) to complete.
		if (terminateOnError) {
			setTimeout(() => {
				process.exit(1);
			}, 1000).unref(); // .unref() allows the program to exit if this is the only active timer.
		}
	});

	// 2. Unhandled Promise Rejection Handler
	process.on('unhandledRejection', (reason, promise) => {
		console.error('------------------------------------');
		console.error('UNHANDLED PROMISE REJECTION!');
		console.error('Reason:', reason);
		// console.error('Promise:', promise); // Can be verbose, enable if needed
		console.error('Stack:', reason instanceof Error ? reason.stack : 'N/A');
		console.error('------------------------------------');
		// Similar to uncaughtException, it's often best to exit.
		// In Node.js v15+, unhandled rejections will terminate the process by default.
		// For older versions, or to be explicit:
		if (terminateOnError) {
			setTimeout(() => {
				process.exit(1);
			}, 1000).unref();
		}
	});
}
