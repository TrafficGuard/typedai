import { join } from 'path';
import { systemDir } from '../../appVars';

// Defined here to avoid circular dependencies
// Shared repos reduces disk usage when only one agent will be working on a particular repo at a time
/** Filesystem path where GitLab repos shared by agents are located */
export const GITLAB_SHARED_REPOS_PATH = join(systemDir(), 'gitlab');
/** Filesystem path where GitHub repos shared by agents are located */
export const GITHUB_SHARED_REPOS_PATH = join(systemDir(), 'github');
