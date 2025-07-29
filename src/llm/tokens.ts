import { type TikTokenizer, createByModelName } from '@microsoft/tiktokenizer';
import { logger } from '#o11y/logger';

let tokenizer: TikTokenizer | null = null;
let loadingTokenizer: Promise<any> | null = null;

export function countTokensSync(text: string): number {
	if (!tokenizer) {
		logger.warn('Tokenizer not initialized');
		countTokens('a').catch((e) => console.error(e));
		return 0;
	}
	return tokenizer.encode(text).length;
}

export async function countTokens(text: string): Promise<number> {
	if (!text) return 0;
	// if(tokenizer === null) return 0;
	// Have a loading guard as some workflows may call this in parallel analysing a multiple files
	if (!tokenizer) {
		if (loadingTokenizer) tokenizer = await loadingTokenizer;
		else {
			loadingTokenizer = createByModelName('gpt-4o');
			try {
				tokenizer = await loadingTokenizer;
			} catch (e) {
				logger.warn(e, 'Could not load tokenizer');
			} finally {
				loadingTokenizer = null;
			}
		}
	}
	return tokenizer?.encode(text).length ?? 0;
}
