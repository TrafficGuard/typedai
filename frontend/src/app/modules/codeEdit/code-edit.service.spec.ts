import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { CodeEditService } from './code-edit.service';

describe('CodeEditService', () => {
	let service: CodeEditService;

	beforeEach(() => {
		TestBed.configureTestingModule({
			// Import HttpClientTestingModule to provide a mock for HttpClient.
			imports: [HttpClientTestingModule],
			providers: [CodeEditService],
		});
		service = TestBed.inject(CodeEditService);
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});
});
