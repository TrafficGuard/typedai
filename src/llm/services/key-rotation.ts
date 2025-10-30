export interface KeyRotator {
	current(): string | undefined;
	next(): string | undefined;
}

export function createEnvKeyRotator(envBase: string, maxSuffix = 9): KeyRotator {
	const keys: string[] = [];
	const base = process.env[envBase];
	if (base) keys.push(base);
	for (let i = 2; i <= maxSuffix; i++) {
		const k = process.env[`${envBase}_${i}`];
		if (k) keys.push(k);
		else break;
	}
	let index = 0;
	return {
		current() {
			return keys.length ? keys[index] : undefined;
		},
		next() {
			if (!keys.length) return undefined;
			const key = keys[index];
			index = (index + 1) % keys.length;
			return key;
		},
	};
}
