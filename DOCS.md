# General code standards 

Do not update project level configuration files unless explicitly instructed to.

Use async/await where possible

Test exceptional cases first and return/throw early.

Never edit files name CONVENTIONS.md, .cursorrules, DOCS.md unless explicitly instructed to.

Prefer composing small descriptive functions over large complex functions.


# Clean Code style guidelines

# Example

## Original code
```typescript
async function cloneProject(projectPathWithOrg: string, branchOrCommit: string): Promise<string> {
    const paths = projectPathWithOrg.split('/');
    if(paths.length !== 2) {
        throw new Error(`${projectPathWithOrg} must be in the format organisation/project`);
    }
    const org = paths[0];
    const project = paths[1];
    
    const agent = agentContext();
    // Determine base path: system-wide or agent-specific
    const basePath = agent?.useSharedRepos ? join(systemDir(), 'github') : agent ? join(agentDir(), 'github') : join(systemDir(), 'github'); // Default to systemDir if no agent context
    
    // Construct the full target path for the project
    const targetPath = join(basePath, org, project);
    
    // Ensure the base directory and organization directory exist
    await fs.mkdir(basePath, {recursive: true});
    await fs.mkdir(join(basePath, org), {recursive: true});
    
    // remainder of the clone function ...
}
```
## Analysis
paths.length validation can be on one line.
The assignment to basePath is too complex with multiple ternary statements.
'github' is repeated many times. The variable which changes in the ternary expression should be extract out.
Group together the statements which setup the folder. Add a comment at the start of the block of statements for readability.
Change targetPath to repoPath, which has more relevant meaning.
"Ensure the base directory and organization directory exist" comment doesn't add value. We can assume the reader knows fundamental built in APIs like fs.mkdir
Having two fs.mkdir() calls is unnecessary

Prefer descriptive variable and function names over redundant comments.
Keep expressions simple
Use throw/return/continue on a single line where reasonable. Especially for initial validation.
Assume the reader knows how the built-in and very popular frameworks/libraries work.
Readable code is in a hierarchy. Within a file is classes/function, and within a function are blocks of code.
See how the updated version reads nicely with simple statements which are self-explanatory, with a concise comment at the start of the block of code for the folder creation for easy visual scanning.
Group code in blocks of lines that are related.

## Refactored code
```typescript
async function cloneProject(projectPathWithOrg: string, branchOrCommit: string): Promise<string> {
    const paths = projectPathWithOrg.split('/');
    if(paths.length !== 2) throw new Error(`${projectPathWithOrg} must be in the format organisation/project`);
    const org = paths[0];
    const project = paths[1];
    
    // Create the folder for the repository
    const agent = agentContext();
    const basePath = !agent || agent.useSharedRepos ? systemDir() : agentDir();
    const repoPath = join(basePath, 'github', org, project);
    await fs.mkdir(repoPath, {recursive: true});
    
    // remainder of the clone function ...
}
```
# Example

## Original code
```typescript
/**
 * Returns the base directory path for a specific agent's storage.
 * @param agentId The ID of the agent.
 * @throws Error if agentId is not provided.
 * @returns The absolute path to the agent's storage directory.
 */
export function getAgentStoragePath(agentId: string): string {
    if (!agentId) {
        // Throw an error because we cannot reliably store/retrieve data without the agentId.
        throw new Error('Agent ID is required to determine agent storage path.');
    }
    // Note: This assumes systemDir() returns the root for TypedAI data.
    return join(systemDir(), 'agents', agentId);
}

/**
 * @return the directory path where an agent can freely read/write to, based on the current agent context.
 */
export function agentDir(): string {
    const agent = agentContext();
    if (!agent || !agent.agentId) {
        // Handle cases where context might not be available, e.g., throw or return a default path?
        // For consistency with getAgentStoragePath, throwing might be better if an agent context is expected.
        throw new Error('Agent context or agentId not available.');
    }
    return getAgentStoragePath(agent.agentId); // Use the helper
}
```
## Analysis
Simplify the agentId validation. The typing assumes we should get a valid id.
The comment "Note: This assumes systemDir() returns the root for TypedAI data." is unnecessary. The systemDir() function which is in the same file, but not shown in this extract, is where data is stored.
We can assume this should be called only when there is an agentContext() given the method is agentDir(). A single line validation is clean and concise.
"Use the helper" comment does not provide any value

## Updated code
```typescript
/**
 * Returns the base directory path for a specific agent's storage.
 * @param agentId The ID of the agent.
 * @throws Error if agentId is not provided.
 * @returns The absolute path to the agent's storage directory.
 */
export function getAgentStoragePath(agentId: string): string {
    if (!agentId) throw new Error('Agent ID is required to determine agent storage path.');
    return join(systemDir(), 'agents', agentId);
}

/**
 * @return the directory path where an agent can freely read/write to, based on the current agent context.
 */
export function agentDir(): string {
    const agent = agentContext();
    if (!agent || !agent.agentId)  throw new Error('Agent context or agentId not available.');
    return getAgentStoragePath(agent.agentId);
}
```

# Example

## Original code
```typescript
async function _hydrateMessageParts(messages: LlmMessage[], agentId: string): Promise<LlmMessage[]> {
    if (!agentId) {
        // No agentId, cannot resolve potential agent:// refs
        logger.warn('No agentId provided, skipping hydration of message parts.');
        return messages;
    }

    const agentStoragePath = agentStorageDir(agentId);
    const msgDataPath = join(agentStoragePath, MSG_DATA_SUBDIR);

    for (const message of messages) {
        if (Array.isArray(message.content)) {
            for (let i = 0; i < message.content.length; i++) {
                const part = message.content[i];
                if (part.type === 'image' || part.type === 'file') {
                    const dataField = part.type === 'image' ? 'image' : 'file';
                    const data = (part as ImagePartExt | FilePartExt)[dataField];

                    if (typeof data === 'string' && data.startsWith(AGENT_REF_PREFIX)) {
                        const uniqueId = data.substring(AGENT_REF_PREFIX.length);
                        const filePath = join(msgDataPath, uniqueId);
                        try {
                            const fileBuffer = await fs.readFile(filePath);
                            // Replace reference string with Buffer
                            (part as any)[dataField] = fileBuffer;
                            message.content[i] = part; // Update the part in the array
                        } catch (error) {
                            logger.error(error, `Failed to read external data file ${filePath} for message part. Leaving reference.`);
                            // Optionally replace with an error indicator instead of leaving the ref:
                            // (part as any)[dataField] = `ERROR: Failed to load ${data}`;
                            // message.content[i] = part;
                        }
                    }
                }
            }
        }
    }
    return messages; // Return messages with hydrated data
}
```
## Analysis
The agentId validation check can be one line.
Exit early from the loop with a `continue` (on one line), and avoid having more brackets and nesting.
In the inner loop again exit early with single line statements.
Use type checking on the dataField value, which caught a mistake in the field names.
The comment "Replace reference string with Buffer" is tautological and adds no value.
filePath isn't very descriptive.
"Return messages with hydrated data" is redundant with the function name being _hydrateMessageParts

## Updated code
```typescript
async function _hydrateMessageParts(messages: LlmMessage[], agentId: string): Promise<LlmMessage[]> {
    if (!agentId) return messages;

    const agentStoragePath = agentStorageDir(agentId);
    const msgDataPath = join(agentStoragePath, MSG_DATA_SUBDIR);
    
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue;
    
        for (let i = 0; i < message.content.length; i++) {
            const part = message.content[i];
            if (!part.externalURL) continue;
            if (part.type !== 'image' && part.type !== 'file') continue;
    
            const dataField: keyof Pick<FilePartExt, 'data'> | keyof Pick<ImagePartExt, 'image'> = part.type === 'image' ? 'image' : 'data';
            const data = (part as ImagePartExt | FilePartExt)[dataField];
    
            const externalFileName = data.substring(AGENT_REF_PREFIX.length);
            const externalFilePath = join(msgDataPath, externalFileName);
            try {
                part[dataField] = await fs.readFile(externalFilePath);
            } catch (e) {
                logger.error(error, `Failed to read external data file ${filePath} for message part. Leaving reference.`);
            }
        }
    }
    return messages;
}
```
### Notes
Notice the groupings in the inner loops.
First 3 lines together is variable initialization and checking conditions.
Next 2 lines are setting up the `dataField` variable based on the type of the part.
The next 2 lines build the file path.
It reads like a story.
dataField, data.
externalFileName, externalFilePath.

# Example
## Original code
```typescript
const checkPromises = filesToStat.map(async (filename) => {
    const absolutePath = join(folder, filename);
    try {
        const stats = await lstat(absolutePath);
        if (stats.isFile()) {
            addFileCallback(absolutePath);
        }
    } catch {
        // File doesn't exist or cannot be accessed, ignore.
    }          
});
```
## Updated code
```typescript
const checkPromises = filesToStat.map(async (filename) => {
    const absolutePath = join(folder, filename);
    try {
        const stats = await lstat(absolutePath);
        if (stats.isFile()) addFileCallback(absolutePath);
    } catch {} // File doesn't exist or cannot be accessed, ignore.
});
```
### Notes
Use single line statements where reasonable. This is a good candidate is there is not much complexity, only the single if statement.
The empty catch block can definitely be on a single line with the comment

# Example
## Original code
```typescript

// Parse the config content
let config: any;
try {
    config = yaml.load(configContent);
} catch (error: any) {
    logger.warn(`Failed to parse YAML ${configPath}: ${error.message}`);
    return; // Stop if parsing fails
}

```
## Updated code
```typescript

let config: any;
try {
    config = yaml.load(configContent);
} catch (error: any) {
    logger.warn(`Failed to parse YAML ${configPath}: ${error.message}`);
    return;
}

```
## Notes
This code block does a simple load, there's no business logic.
The between the `yaml.load` and the warn message is enough for the reader to quickly understand. No further comments are required.

# Example

## Orignal
```
const maxAttempts = 3; // Max reflection attempts
```
## Updated
```typescript
const maxReflectionAttempts = 3;
```
## Notes
Use descriptive variable and function names instead of commenting on generic names.


# Example - Minimise unnecessary line count

## Original
This code was repeated multiple times through the tests. Extract it into a helper function.
```typescript
			expect(
    await fsAsync
        .access(orphanedSummaryFullPath)
        .then(() => true)
        .catch(() => false),
    'Orphaned summary should exist initially',
).to.be.true;
```

## Updated
```typescript
async function fileExists(filePath: string): Promise<boolean> {
    return fsAsync
        .access(filePath)
        .then(() => true)
        .catch(() => false);
}
it('should test foo', async () => {
    expect(await fileExists(orphanedSummaryFullPath)).to.be.true;
})
```

## Original

```typescript
logger.info(
			`Indexing pipeline completed. Successfully prepared ${successfullyProcessedAndEmbeddedChunks} chunks from ${
				codeFiles.length - failedFilesCount.count
			} files for indexing.`,
		);
```

# Updated
```typescript
const successCount = codeFiles.length - failedFilesCount.count
logger.info(`Indexing completed. Prepared ${successfullyProcessedAndEmbeddedChunks} chunks from ${successCount} files.`);
```

## Notes
Extracting the successCount calculation into a variable and shortening the wording so the statement can be on a single line reduces the line count from 5 down to 2.

## Example
## Before
```typescript
async indexRepository(dir = './'): Promise<void> {
    const codeFiles = await readFilesToIndex(dir);
    logger.info(`Loaded ${codeFiles.length} code files.`);

    if (codeFiles.length === 0) {
        logger.info('No files to index.');
        return;
    }
    // ...
}
```
Review - Its already logged that 0 files were loaded. The additional logging is redundant

### After

```typescript
async indexRepository(dir = './'): Promise<void> {
    const codeFiles = await readFilesToIndex(dir);
    logger.info(`Loaded ${codeFiles.length} code files.`);

    if (codeFiles.length === 0) return;
    // ...
}
```

# Unnecassary seperate function

## Before
```typescript
async importDocuments(documents: google.cloud.discoveryengine.v1beta.IDocument[], file: CodeFile): Promise<void> {
    if (documents.length === 0) return;
    await this.ensureDataStoreExists();

    const request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest = {
        parent: `${this.dataStorePath}/branches/default_branch`,
        inlineSource: { documents },
        reconciliationMode: google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
    };

    await this._importDocumentsRequest(request);
}

@cacheRetry({ retries: 3, backOffMs: 1000 })
@quotaRetry()
private async _importDocumentsRequest(request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest): Promise<void> {
    const [operation] = await this.documentClient.importDocuments(request);
    logger.info(`ImportDocuments operation started: ${operation.name}`);
    await operation.promise(); // wait until the indexing finishes
}
```

## After
```typescript
@cacheRetry({ retries: 3, backOffMs: 1000 })
@quotaRetry()
async importDocuments(documents: google.cloud.discoveryengine.v1beta.IDocument[], file: CodeFile): Promise<void> {
    if (documents.length === 0) return;

    const request: google.cloud.discoveryengine.v1beta.IImportDocumentsRequest = {
        parent: `${this.dataStorePath}/branches/default_branch`,
        inlineSource: { documents },
        reconciliationMode: google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
    };

    const [operation] = await this.documentClient.importDocuments(request);
    logger.info(`ImportDocuments operation started: ${operation.name}`);
    await operation.promise(); // wait until the indexing finishes
}
```
    
## Conversion of database data to domain objects

### Example

#### Before

```typescript
const querySnapshot = await iterationsColRef.orderBy('__name__').get(); // Order by document ID (iteration number)

const iterations: AutonomousIteration[] = [];
querySnapshot.forEach((doc) => {
    const data = doc.data();
    if (data && typeof data.iteration === 'number') {
        // Ensure memory is a Record, defaulting to {} if missing or not a valid object.
        data.memory = data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory) ? data.memory : {};

        // Ensure toolState is a Record, defaulting to {} if missing or not a valid object.
        data.toolState = data.toolState && typeof data.toolState === 'object' && !Array.isArray(data.toolState) ? data.toolState : {};

        // Ensure optional fields are correctly handled (set to undefined if missing/null)
        data.error = data.error || undefined;
        data.agentPlan = data.agentPlan || undefined;
        data.code = data.code || undefined;
        data.prompt = data.prompt || undefined;
        data.functionCalls = data.functionCalls || [];
        data.functions = data.functions || [];
        data.createdAt = data.createdAt || Date.now();
        // expandedUserRequest, observationsReasoning, nextStepDetails might also need default handling if optional
        data.expandedUserRequest = data.expandedUserRequest || undefined;
        data.observationsReasoning = data.observationsReasoning || undefined;
        data.nextStepDetails = data.nextStepDetails || undefined;
        // Ensure optional fields potentially missing from Firestore are set
        data.draftCode = data.draftCode || undefined;
        data.codeReview = data.codeReview || undefined;

        iterations.push(data as AutonomousIteration);
    } else {
        logger.warn({ agentId, iterationId: doc.id }, 'Skipping invalid iteration data during load (missing or invalid iteration number)');
    }
});
```

#### After

```typescript
const iterations: AutonomousIteration[] = [];
querySnapshot.forEach((doc) => {
    const data = doc.data();
    
    if (data && typeof data.iteration === 'number') {
        const iter: AutonomousIteration = {
            // Ensure memory is a Record, defaulting to {} if missing or not a valid object.
            memory: data.memory && typeof data.memory === 'object' && !Array.isArray(data.memory) ? data.memory : {},
            // Ensure toolState is a Record, defaulting to {} if missing or not a valid object.
            toolState: data.toolState && typeof data.toolState === 'object' && !Array.isArray(data.toolState) ? data.toolState : {},
            // Handle optional fields using safe defaults
            error: data.error || undefined,
            agentPlan: data.agentPlan || undefined,
            code: data.code || undefined,
            prompt: data.prompt || undefined,
            functionCalls: data.functionCalls || [],
            functions: data.functions || [],
            createdAt: data.createdAt || Date.now(),
            expandedUserRequest: data.expandedUserRequest || undefined,
            observationsReasoning: data.observationsReasoning || undefined,
            nextStepDetails: data.nextStepDetails || undefined,
            draftCode: data.draftCode || undefined,
            codeReview: data.codeReview || undefined,
            // Required field
            iteration: data.iteration
        };
        iterations.push(iter);
    } else {
        logger.warn({ agentId, iterationId: doc.id },'Skipping invalid iteration data during load (missing or invalid iteration number)');
    }
});
```
### Notes
Assign to the typed AutonomousIteration object to ensure type safety.
