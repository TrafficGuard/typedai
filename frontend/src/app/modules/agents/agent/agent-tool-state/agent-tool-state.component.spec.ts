import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AgentContextApi, FileMetadata } from '#shared/agent/agent.schema'; // Assuming FileMetadata is in agent.schema
import { AgentToolStateComponent } from './agent-tool-state.component';
import { AgentToolStatePo } from './agent-tool-state.component.po';

describe('AgentToolStateComponent', () => {
	let component: AgentToolStateComponent;
	let fixture: ComponentFixture<AgentToolStateComponent>;
	let po: AgentToolStatePo;

	const mockAgentContextEmpty: AgentContextApi = {
		toolState: {
			LiveFiles: [],
			FileStore: [],
		},
	};

	const mockAgentContextWithData: AgentContextApi = {
		toolState: {
			LiveFiles: ['file1.ts', 'file2.js'],
			FileStore: [
				{ filename: 'doc1.pdf', description: 'Test Doc 1', size: 1024, lastUpdated: 1678886400000 }, // Example timestamp
				{ filename: 'doc2.txt', description: 'Test Doc 2', size: 2048, lastUpdated: 1678972800000 }, // Example timestamp
			],
		},
	};

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				AgentToolStateComponent, // Import standalone component
				NoopAnimationsModule,
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentToolStateComponent);
		component = fixture.componentInstance;
		// PO creation will handle initial detectChanges and whenStable
		// Required input 'agentDetails' will be set per test.
		// Not setting it here to avoid errors if a test needs to check behavior before it's set (though less likely with required input).
	});

	it('should create', async () => {
		// Set a minimal valid input for creation to succeed due to input.required
		fixture.componentRef.setInput('agentDetails', mockAgentContextEmpty);
		fixture.detectChanges(); // Initial change detection for component creation
		await fixture.whenStable();
		po = await AgentToolStatePo.create(fixture); // PO create calls detectAndWait
		expect(component).toBeTruthy();
		expect(po).toBeTruthy();
	});

	describe('Functional tests', () => {
		beforeEach(async () => {
			// For functional tests, ensure PO is created after initial fixture setup.
			// Specific inputs will be set within each test.
			// Setting a default here to ensure component initializes for PO creation.
			fixture.componentRef.setInput('agentDetails', mockAgentContextEmpty);
			fixture.detectChanges();
			await fixture.whenStable();
			po = await AgentToolStatePo.create(fixture);
		});

		it('should display live files when agentDetails has liveFiles', async () => {
			await po.setAgentDetails(mockAgentContextWithData);

			const liveFileTexts = await po.getLiveFileTexts();
			expect(liveFileTexts.length).toBe(2);
			expect(liveFileTexts).toEqual(['file1.ts', 'file2.js']);
			expect(await po.hasNoLiveFilesMessage()).toBeFalse();
		});

		it('should display "No live files available." message when liveFiles is empty', async () => {
			await po.setAgentDetails(mockAgentContextEmpty);

			const liveFileTexts = await po.getLiveFileTexts();
			expect(liveFileTexts.length).toBe(0);
			expect(await po.hasNoLiveFilesMessage()).toBeTrue();
			expect(await po.getNoLiveFilesMessageText()).toBe('No live files available.');
		});

		it('should display file store entries when agentDetails has fileStore entries', async () => {
			await po.setAgentDetails(mockAgentContextWithData);

			expect(await po.hasFileStoreTable()).toBeTrue();
			const tableRows = await po.getFileStoreTableRowsAsText();
			expect(tableRows.length).toBe(2);
			expect(tableRows[0]).toEqual(['doc1.pdf', 'Test Doc 1', '1024', '1678886400000']);
			expect(tableRows[1]).toEqual(['doc2.txt', 'Test Doc 2', '2048', '1678972800000']);
			expect(await po.hasNoFileStoreEntriesMessage()).toBeFalse();
		});

		it('should display "No file store entries available." message when fileStore is empty', async () => {
			await po.setAgentDetails(mockAgentContextEmpty);

			expect(await po.hasFileStoreTable()).toBeFalse(); // Table might not render if dataSource is empty depending on MatTable's behavior with no data template
			expect(await po.hasNoFileStoreEntriesMessage()).toBeTrue();
			expect(await po.getNoFileStoreEntriesMessageText()).toBe('No file store entries available.');
		});

		it('should display correct headers for the file store table', async () => {
			await po.setAgentDetails(mockAgentContextWithData); // Need data for the table to render

			expect(await po.hasFileStoreTable()).toBeTrue();
			const headers = await po.getFileStoreTableHeaders();
			// Note: MatTableHarness getCellTextByColumnName for headers returns an object,
			// let's adapt to get an array of header texts in order.
			// The PO method getFileStoreTableHeaders() should be adjusted if direct array is needed.
			// For now, assuming it returns an object keyed by column definition:
			// { filename: 'Filename', description: 'Description', size: 'Size', lastUpdated: 'Lastupdated' }
			// The component uses `{{ column | titlecase }}`.
			const expectedHeaders = component.displayedColumns.reduce(
				(acc, col) => {
					acc[col] = col.charAt(0).toUpperCase() + col.slice(1);
					return acc;
				},
				{} as Record<string, string>,
			);
			expect(headers).toEqual(expectedHeaders);
		});

		it('should display both live files and file store entries correctly when both are provided', async () => {
			await po.setAgentDetails(mockAgentContextWithData);

			// Check live files
			const liveFileTexts = await po.getLiveFileTexts();
			expect(liveFileTexts).toEqual(['file1.ts', 'file2.js']);
			expect(await po.hasNoLiveFilesMessage()).toBeFalse();

			// Check file store
			expect(await po.hasFileStoreTable()).toBeTrue();
			const tableRows = await po.getFileStoreTableRowsAsText();
			expect(tableRows.length).toBe(2);
			expect(tableRows[0][0]).toBe('doc1.pdf');
			expect(await po.hasNoFileStoreEntriesMessage()).toBeFalse();
		});

		// This test addresses the loading state if agentDetails is not provided.
		// However, `input.required` makes this scenario less about "loading" and more about "misconfiguration"
		// if the parent doesn't pass the input. The spinner in the template is in an `else` for `*ngIf="agentDetails()"`.
		// If `agentDetails` is required, it should always be truthy.
		// A more accurate test for the spinner might be if the *parent* is loading the data for agentDetails.
		// For this component, we assume agentDetails is provided.
		// If we want to test the spinner, we'd have to simulate a state where agentDetails() is undefined/null,
		// which contradicts input.required.
		// The template's spinner is likely a fallback if the signal itself is somehow null, not for data loading within the signal.
		// Let's skip testing the spinner directly via this component's PO as its display logic is tied to `agentDetails()` being falsy.
		// it('should display loading spinner if agentDetails is not provided', async () => {
		// // This test is tricky with input.required.
		// // To test the <ng-template #loading>, agentDetails() must be falsy.
		// // One way could be to not set the input, but that might cause Angular to error.
		// // Or, set it to null/undefined if the type allows (input.required<Type> vs input<Type|null|undefined>).
		// // For now, we assume agentDetails is always provided due to `input.required`.
		// });
	});
});
