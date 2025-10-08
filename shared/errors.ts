export class NotFound extends Error {
	code = 'NOT_FOUND';

	constructor(message: string) {
		super(message);
		this.name = 'NotFoundError';
	}
}

export class FileNotFound extends Error {
	code: string;
	constructor(message: string, code = 'ENOENT') {
		super(message);
		this.name = 'FileNotFound';
		this.code = code;
	}
}

export class NotAllowed extends Error {
	code = 'NOT_ALLOWED';

	constructor(message: string) {
		super(message);
		this.name = 'NotAllowed';
	}
}
