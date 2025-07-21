import type { AppFastifyInstance } from '#app/applicationTypes';
import { commitChangesRoute } from './commitChangesRoute';
import { createCodeTaskRoute } from './createCodeTaskRoute';
import { createPresetRoute } from './createPresetRoute';
import { deleteCodeTaskRoute } from './deleteCodeTaskRoute';
import { deletePresetRoute } from './deletePresetRoute';
import { executeDesignRoute } from './executeDesignRoute';
import { generateDesignRoute } from './generateDesignRoute';
import { getCodeTaskByIdRoute } from './getCodeTaskByIdRoute';
import { getFileContentRoute } from './getFileContentRoute';
import { getFileSystemTreeRoute } from './getFileSystemTreeRoute';
import { getRepoBranchesRoute } from './getRepoBranchesRoute';
import { listCodeTasksRoute } from './listCodeTasksRoute';
import { listPresetsRoute } from './listPresetsRoute';
import { resetSelectionRoute } from './resetSelectionRoute';
import { updateCodeRoute } from './updateCodeRoute';
import { updateCodeTaskRoute } from './updateCodeTaskRoute';
import { updateDesignPromptRoute } from './updateDesignPromptRoute';
import { updateDesignRoute } from './updateDesignRoute';
import { updateSelectionPromptRoute } from './updateSelectionPromptRoute';

export async function codeTaskRoutes(fastify: AppFastifyInstance): Promise<void> {
	await createCodeTaskRoute(fastify);
	await listCodeTasksRoute(fastify);
	await getCodeTaskByIdRoute(fastify);
	await updateCodeTaskRoute(fastify);
	await deleteCodeTaskRoute(fastify);

	await createPresetRoute(fastify);
	await listPresetsRoute(fastify);
	await deletePresetRoute(fastify);

	await updateSelectionPromptRoute(fastify);
	await generateDesignRoute(fastify);
	await updateDesignRoute(fastify);
	await updateDesignPromptRoute(fastify);
	await executeDesignRoute(fastify);
	await resetSelectionRoute(fastify);
	await updateCodeRoute(fastify);
	await commitChangesRoute(fastify);

	await getRepoBranchesRoute(fastify);
	await getFileSystemTreeRoute(fastify);
	await getFileContentRoute(fastify);
}
