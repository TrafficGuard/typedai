import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AgentContextApi } from '#shared/agent/agent.schema'; // Adjusted path
import { AgentMemoryComponent } from './agent-memory.component';
import { AgentMemoryPo } from './agent-memory.component.po';

describe('AgentMemoryComponent', () => {
	let component: AgentMemoryComponent;
	let fixture: ComponentFixture<AgentMemoryComponent>;
	let po: AgentMemoryPo;

	const mockAgentDetailsWithMemory: AgentContextApi = {
		agentId: 'test-agent',
		// Add other required AgentContextApi properties if any, or use a partial mock if schema allows
		memory: {
			key1: 'value1',
			key2: { nested: 'value2' },
			longKey3: 'This is a longer value for key3 to test preview and full view.',
		},
	};

	const mockAgentDetailsEmptyMemory: AgentContextApi = {
		agentId: 'test-agent-empty',
		memory: {},
	};

	const mockAgentDetailsNullMemory: AgentContextApi = {
		agentId: 'test-agent-null',
		memory: null,
	};

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [
				AgentMemoryComponent, // Standalone component
				NoopAnimationsModule,
			],
		}).compileComponents();

		fixture = TestBed.createComponent(AgentMemoryComponent);
		component = fixture.componentInstance;
		po = await AgentMemoryPo.create(fixture); // Creates PO and calls detectChanges/whenStable
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	describe('Functional tests', () => {
		it('should display memory entries when agentDetails input is provided with memory', async () => {
			// Arrange
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithMemory);
			await po.detectAndWait(); // Ensure component reacts to input

			// Act
			const displayedKeys = await po.getMemoryEntryKeys();

			// Assert
			expect(displayedKeys.length).toBe(Object.keys(mockAgentDetailsWithMemory.memory!).length);
			for (const key of Object.keys(mockAgentDetailsWithMemory.memory!)) {
				expect(displayedKeys).toContain(key);
				expect(await po.isMemoryEntryExpanded(key)).toBe(false); // Initially collapsed
				const preview = await po.getMemoryEntryValuePreview(key);
				// Check if preview contains a substring of the stringified value
				const expectedPreviewPart = JSON.stringify(mockAgentDetailsWithMemory.memory![key]).substring(0, 10);
				expect(preview).toContain(expectedPreviewPart);
			}
			expect(await po.hasNoMemoryMessage()).toBe(false);
		});

		it('should expand an entry and show full value on toggle', async () => {
			// Arrange
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsWithMemory);
			await po.detectAndWait();
			const testKey = 'key2'; // A key with a non-trivial value

			// Act
			await po.toggleMemoryEntry(testKey);
			await po.detectAndWait(); // Ensure DOM updates after toggle

			// Assert
			expect(await po.isMemoryEntryExpanded(testKey)).toBe(true);
			const fullValueHtml = await po.getMemoryEntryFullValue(testKey);
			const expectedHtml = component.convertMemoryValue(mockAgentDetailsWithMemory.memory![testKey]);
			expect(fullValueHtml).toBe(expectedHtml);

			// Act: Toggle again to collapse
			await po.toggleMemoryEntry(testKey);
			await po.detectAndWait();

			// Assert
			expect(await po.isMemoryEntryExpanded(testKey)).toBe(false);
		});

		it('should display "no memory" message when agentDetails.memory is empty', async () => {
			// Arrange
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsEmptyMemory);
			await po.detectAndWait();

			// Act & Assert
			expect(await po.hasNoMemoryMessage()).toBe(true);
			expect(await po.getMemoryEntryKeys()).toEqual([]);
		});

		it('should display "no memory" message when agentDetails.memory is null', async () => {
			// Arrange
			fixture.componentRef.setInput('agentDetails', mockAgentDetailsNullMemory);
			await po.detectAndWait();

			// Act & Assert
			expect(await po.hasNoMemoryMessage()).toBe(true);
			expect(await po.getMemoryEntryKeys()).toEqual([]);
		});

		it('should display "no memory" message when agentDetails input is null', async () => {
			// Arrange
			fixture.componentRef.setInput('agentDetails', null);
			await po.detectAndWait();

			// Act & Assert
			expect(await po.hasNoMemoryMessage()).toBe(true);
			expect(await po.getMemoryEntryKeys()).toEqual([]);
		});
	});
});
