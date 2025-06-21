import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { EditBlock } from '../coderTypes';
import type { ValidationIssue } from '../validators/validationRule';
import type { MetaRequests } from './ResponseProcessor';

export class ReflectionGenerator {
	buildValidationReflection(issues: ValidationIssue[]): string {
		// From buildValidationIssuesReflection
		throw new Error('Not implemented');
	}

	async buildFailureReflection(failedEdits: EditBlock[], numPassed: number, fs: IFileSystemService, rootPath: string): Promise<string> {
		// From buildFailedEditsReflection
		throw new Error('Not implemented');
	}

	buildMetaRequestReflection(metaRequests: MetaRequests): string {
		// Extract from current inline logic
		throw new Error('Not implemented');
	}

	buildExternalChangeReflection(changedFiles: string[]): string {
		return `The following file(s) were modified after the edit blocks were generated: ${changedFiles.join(
			', ',
		)}. Their content has been updated in your context. Please regenerate the edits using the updated content.`;
	}
}
