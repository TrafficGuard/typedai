import { BaseHarnessFilters, ComponentHarness, ComponentHarnessConstructor, HarnessLoader, HarnessPredicate } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

export abstract class BaseSpecPo<T> {
	private readonly ATTR = 'data-testid';
	protected readonly fix: ComponentFixture<T>;
	protected readonly loader: HarnessLoader;

	// Change 'protected' to 'public' to allow static create method to instantiate derived classes
	public constructor(fixture: ComponentFixture<T>) {
		this.fix = fixture;
		this.loader = TestbedHarnessEnvironment.loader(fixture);
	}

	/* --------------------------------------------------
       Core element helpers (data-testid)
       -------------------------------------------------- */
	protected el(id: string) {
		const res = this.fix.debugElement.query(By.css(`[${this.ATTR}="${id}"]`));
		if (!res) throw new Error(`Element ${id} not found`);
		return res;
	}
	protected els(id: string) {
		return this.fix.debugElement.queryAll(By.css(`[${this.ATTR}="${id}"]`));
	}

	/** current value of <input>/<textarea> */
	value(id: string): string {
		return (this.el(id).nativeElement as HTMLInputElement | HTMLTextAreaElement).value;
	}

	/* --------------------------------------------------
       Low-level interactions
       -------------------------------------------------- */
	async click(id: string) {
		this.el(id).nativeElement.click();
		await this.detectAndWait();
	}
	async type(id: string, value: string) {
		const input = this.el(id).nativeElement as HTMLInputElement;
		input.value = value;
		input.dispatchEvent(new Event('input'));
		await this.detectAndWait();
	}

	/** press a key on an element */
	async pressKey(id: string, key: string, opt: Partial<KeyboardEvent> = {}): Promise<void> {
		const el = this.el(id).nativeElement;
		el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opt }));
		await this.detectAndWait();
	}

	/** set files on a hidden <input type=file> */
	async setFiles(id: string, files: File[]) {
		const input = this.el(id).nativeElement as HTMLInputElement;
		const dt = new DataTransfer();
		files.forEach((f) => dt.items.add(f));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await this.detectAndWait();
	}

	/* --------------------------------------------------
       Expectations
       -------------------------------------------------- */
	text(id: string): string {
		return (this.el(id).nativeElement.textContent || '').trim();
	}
	// NEW helper that returns only a boolean, no assertion
	has(id: string): boolean {
		return this.els(id).length > 0;
	}

	// RENAME: exists -> expectExists
	expectExists(id: string): void {
		const count = this.els(id).length;
		expect(count).withContext(`Expected element with test id '${id}' to exist`).toBeGreaterThan(0);
	}

	// RENAME: missing -> expectMissing
	expectMissing(id: string): void {
		const count = this.els(id).length;
		expect(count).withContext(`Expected element with test id '${id}' to be missing`).toBe(0);
	}

	/* --------------------------------------------------
       Harness shortcuts
       -------------------------------------------------- */
	protected harness<H extends ComponentHarness, P extends BaseHarnessFilters>(
		harnessType: ComponentHarnessConstructor<H>, // This is the constructor type TypeScript is seeing
		options?: P,
	): Promise<H> {
		if (options) {
			// If options are provided, create a HarnessPredicate instance manually.
			// The HarnessPredicate constructor typically takes the harness type and options.
			const predicate = new HarnessPredicate(harnessType, options);
			return this.loader.getHarness(predicate);
		}
		// If no options, get the harness directly by its type.
		return this.loader.getHarness(harnessType);
	}

	/* --------------------------------------------------
       CD + async
       -------------------------------------------------- */
	// Change 'protected' to 'public' to allow test specs to call it
	public async detectAndWait() {
		this.fix.detectChanges();
		await this.fix.whenStable();
		this.fix.detectChanges();
	}

	/* Utility so tests can write: const po = await LoginPo.create(fix) */
	static async create<C, PO extends BaseSpecPo<C>>(this: new (f: ComponentFixture<C>) => PO, fix: ComponentFixture<C>): Promise<PO> {
		fix.detectChanges();
		await fix.whenStable();
		return new BaseSpecPo(fix);
	}
}
