export class NotFound extends Error {}

export class FileNotFound extends Error {
	code: string;
	constructor(message: string, code = 'ENOENT') {
		super(message);
		this.name = 'FileNotFound';
		this.code = code;
	}
}

export class NotAllowed extends Error {}

export class InvalidRequest extends Error {}
