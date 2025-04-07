import { TikTokenizer, createByModelName } from '@microsoft/tiktokenizer';

let tokenizer: TikTokenizer;

export async function initTokenizer(): Promise<void> {
	tokenizer ??= await createByModelName('gpt-4o');
}

export async function countTokens(text: string): Promise<number> {
	tokenizer ??= await createByModelName('gpt-4o');
	return tokenizer.encode(text).length;
}

export function countTokensSync(text: string): number {
	if (!tokenizer) throw new Error('Must call initTokenizer() or countTokens() before calling countTokensSync()');
	return tokenizer.encode(text).length;
}
