import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { stripQuotedWrapping } from '../../../../utils/string-utils';
import { logger } from '../../../../o11y/logger';
import type { EditBlock } from '../coderTypes';
import type { EditSession } from '../state/EditSession';

export class EditPreparer {
	constructor(
		private fs: IFileSystemService,
		private vcs: VersionControlSystem | null,
	) {}

	async prepare(blocks: EditBlock[], session: EditSession): Promise<PrepareResult> {
		const result: PrepareResult = {
			validBlocks: [],
			dirtyFiles: new Set(),
			externalChanges: [],
		};

		// Implementation will be added in a subsequent step.

		return result;
	}
}

export interface PrepareResult {
	validBlocks: EditBlock[];
	dirtyFiles: Set<string>;
	externalChanges: string[];
}
