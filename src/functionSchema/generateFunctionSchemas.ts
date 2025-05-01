import { appContext } from '#app/applicationContext';
import { functionRegistry } from '../functionRegistry';

// [DOC] For CLI tool to pre-build the function schemas for faster startup time
appContext(); // Init the in-memory context
functionRegistry();
