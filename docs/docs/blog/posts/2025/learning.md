---
draft: true 
date: 2024-01-31 
categories:
  - Intro
---

# Diff
 export async function selectFilesAndExtracts(requirements: UserContentExt, projectInfo?: ProjectInfo): Promise<SelectFilesAndExtractsResult> {
-	const { files: initialSelectedFiles, answer: answerFromInitialQuery } = await queryWithFileSelection2(requirements, projectInfo);
+	const { files: initialSelectedFiles, answer: answerFromInitialQuery } = await queryWithFileSelection2(requirements, !!projectInfo);
 	if (!initialSelectedFiles || initialSelectedFiles.length === 0) {
 		logger.info('selectFilesAndExtracts: No initial files selected by queryWithFileSelection2.');
 		return { editableFiles: [], readOnlyFilesWithExtracts: {}, answerFromInitialQuery };

# Compiler analysis:
The compilation failed due to a backend TypeScript error, which is unrelated to the frontend files currently in the context.

- **Analysis of the compile issues**: The error `src/swe/discovery/selectFilesAgentWithExtracts.ts(29,118): error TS2345: Argument of type 'ProjectInfo' is not assignable to parameter of type 'boolean'` indicates a type mismatch. A function or method is being called with an argument of type `ProjectInfo` where a `boolean` is expected.
- **Reasoning for additional files**: To fix this, I need to see the code in the file where the error occurs, `src/swe/discovery/selectFilesAgentWithExtracts.ts`. It's also highly likely that I will need to see the definition of the function being called to understand its expected parameters. Based on the context, that function is likely defined in `src/swe/discovery/selectFilesToEdit.ts`.

<json>
{
   "compileIssuesSummary": "The build failed due to a TypeScript type error in a backend file. An argument of type 'ProjectInfo' is being passed to a function that expects a 'boolean'.",
   "researchQuery": "",
   "installPackages": [],
   "additionalFiles": [
      "src/swe/discovery/selectFilesAgentWithExtracts.ts",
      "src/swe/discovery/selectFilesToEdit.ts"
   ],
   "fatalError": ""
}
</json>

Need to add another step to extract filenames, which we had for static analysis. Could potentillay use the agentic search to do the analysis