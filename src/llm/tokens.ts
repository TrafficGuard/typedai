import { TikTokenizer, createByModelName } from '@microsoft/tiktokenizer';

let tokenizer: TikTokenizer;

export async function countTokens(text: string): Promise<number> {
	tokenizer ??= await createByModelName('gpt-4o');
	return tokenizer.encode(text).length;
}
