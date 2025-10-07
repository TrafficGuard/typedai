const KNOWN_ERRORS = [
	["Error: keys does not support 'str' type. Please provide or select a struct.", 'Check the yaml files in ./variables are valid yaml'],
	[
		'`npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync',
		'Run `npm install` to update the lock file to match the package.json',
	],
];

export function knownBuildErrors() {
	return KNOWN_ERRORS;
}
