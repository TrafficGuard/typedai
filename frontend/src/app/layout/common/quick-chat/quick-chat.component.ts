import type { ScrollStrategy, ScrollStrategyOptions } from '@angular/cdk/overlay';
import { TextFieldModule } from '@angular/cdk/text-field';
import { DOCUMENT, DatePipe, NgClass, NgTemplateOutlet } from '@angular/common';
import {
	type AfterViewInit,
	Component,
	ElementRef,
	HostBinding,
	HostListener,
	Inject,
	NgZone,
	OnDestroy,
	OnInit,
	Renderer2,
	ViewChild,
	ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { FuseScrollbarDirective } from '@fuse/directives/scrollbar';
import type { QuickChatService } from 'app/layout/common/quick-chat/quick-chat.service';
import type { Chat } from 'app/layout/common/quick-chat/quick-chat.types';
import { Subject, takeUntil } from 'rxjs';

@Component({
	selector: 'quick-chat',
	templateUrl: './quick-chat.component.html',
	styleUrls: ['./quick-chat.component.scss'],
	encapsulation: ViewEncapsulation.None,
	exportAs: 'quickChat',
	imports: [NgClass, MatIconModule, MatButtonModule, FuseScrollbarDirective, NgTemplateOutlet, MatFormFieldModule, MatInputModule, TextFieldModule, DatePipe],
})
export class QuickChatComponent implements OnInit, AfterViewInit, OnDestroy {
	@ViewChild('messageInput') messageInput: ElementRef;
	chat: Chat;
	chats: Chat[];
	opened = false;
	selectedChat: Chat;
	private _mutationObserver: MutationObserver;
	private _scrollStrategy: ScrollStrategy = this._scrollStrategyOptions.block();
	private _overlay: HTMLElement;
	private _unsubscribeAll: Subject<any> = new Subject<any>();

	/**
	 * Constructor
	 */
	constructor(
		@Inject(DOCUMENT) private _document: Document,
		private _elementRef: ElementRef,
		private _renderer2: Renderer2,
		private _ngZone: NgZone,
		private _quickChatService: QuickChatService,
		private _scrollStrategyOptions: ScrollStrategyOptions,
	) {}

	// -----------------------------------------------------------------------------------------------------
	// @ Decorated methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Host binding for component classes
	 */
	@HostBinding('class') get classList(): any {
		return {
			'quick-chat-opened': this.opened,
		};
	}

	/**
	 * Resize on 'input' and 'ngModelChange' events
	 *
	 * @private
	 */
	@HostListener('input')
	@HostListener('ngModelChange')
	private _resizeMessageInput(): void {
		// This doesn't need to trigger Angular's change detection by itself
		this._ngZone.runOutsideAngular(() => {
			setTimeout(() => {
				// Set the height to 'auto' so we can correctly read the scrollHeight
				this.messageInput.nativeElement.style.height = 'auto';

				// Get the scrollHeight and subtract the vertical padding
				this.messageInput.nativeElement.style.height = `${this.messageInput.nativeElement.scrollHeight}px`;
			});
		});
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Lifecycle hooks
	// -----------------------------------------------------------------------------------------------------

	/**
	 * On init
	 */
	ngOnInit(): void {
		// Chat
		this._quickChatService.chat$.pipe(takeUntil(this._unsubscribeAll)).subscribe((chat: Chat) => {
			this.chat = chat;
		});

		// Chats
		this._quickChatService.chats$.pipe(takeUntil(this._unsubscribeAll)).subscribe((chats: Chat[]) => {
			this.chats = chats;
		});

		// Selected chat
		this._quickChatService.chat$.pipe(takeUntil(this._unsubscribeAll)).subscribe((chat: Chat) => {
			this.selectedChat = chat;
		});
	}

	/**
	 * After view init
	 */
	ngAfterViewInit(): void {
		// Fix for Firefox.
		//
		// Because 'position: sticky' doesn't work correctly inside a 'position: fixed' parent,
		// adding the '.cdk-global-scrollblock' to the html element breaks the navigation's position.
		// This fixes the problem by reading the 'top' value from the html element and adding it as a
		// 'marginTop' to the navigation itself.
		this._mutationObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				const mutationTarget = mutation.target as HTMLElement;
				if (mutation.attributeName === 'class') {
					if (mutationTarget.classList.contains('cdk-global-scrollblock')) {
						const top = Number.parseInt(mutationTarget.style.top, 10);
						this._renderer2.setStyle(this._elementRef.nativeElement, 'margin-top', `${Math.abs(top)}px`);
					} else {
						this._renderer2.setStyle(this._elementRef.nativeElement, 'margin-top', null);
					}
				}
			});
		});
		this._mutationObserver.observe(this._document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
	}

	/**
	 * On destroy
	 */
	ngOnDestroy(): void {
		// Disconnect the mutation observer
		this._mutationObserver.disconnect();

		// Unsubscribe from all subscriptions
		this._unsubscribeAll.next(null);
		this._unsubscribeAll.complete();
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Public methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Open the panel
	 */
	open(): void {
		// Return if the panel has already opened
		if (this.opened) {
			return;
		}

		// Open the panel
		this._toggleOpened(true);
	}

	/**
	 * Close the panel
	 */
	close(): void {
		// Return if the panel has already closed
		if (!this.opened) {
			return;
		}

		// Close the panel
		this._toggleOpened(false);
	}

	/**
	 * Toggle the panel
	 */
	toggle(): void {
		if (this.opened) {
			this.close();
		} else {
			this.open();
		}
	}

	/**
	 * Select the chat
	 *
	 * @param id
	 */
	selectChat(id: string): void {
		// Open the panel
		this._toggleOpened(true);

		// Get the chat data
		this._quickChatService.getChatById(id).subscribe();
	}

	/**
	 * Track by function for ngFor loops
	 *
	 * @param index
	 * @param item
	 */
	trackByFn(index: number, item: any): any {
		return item.id || index;
	}

	// -----------------------------------------------------------------------------------------------------
	// @ Private methods
	// -----------------------------------------------------------------------------------------------------

	/**
	 * Show the backdrop
	 *
	 * @private
	 */
	private _showOverlay(): void {
		// Try hiding the overlay in case there is one already opened
		this._hideOverlay();

		// Create the backdrop element
		this._overlay = this._renderer2.createElement('div');

		// Return if overlay couldn't be create for some reason
		if (!this._overlay) {
			return;
		}

		// Add a class to the backdrop element
		this._overlay.classList.add('quick-chat-overlay');

		// Append the backdrop to the parent of the panel
		this._renderer2.appendChild(this._elementRef.nativeElement.parentElement, this._overlay);

		// Enable block scroll strategy
		this._scrollStrategy.enable();

		// Add an event listener to the overlay
		this._overlay.addEventListener('click', () => {
			this.close();
		});
	}

	/**
	 * Hide the backdrop
	 *
	 * @private
	 */
	private _hideOverlay(): void {
		if (!this._overlay) {
			return;
		}

		// If the backdrop still exists...
		if (this._overlay) {
			// Remove the backdrop
			this._overlay.parentNode.removeChild(this._overlay);
			this._overlay = null;
		}

		// Disable block scroll strategy
		this._scrollStrategy.disable();
	}

	/**
	 * Open/close the panel
	 *
	 * @param open
	 * @private
	 */
	private _toggleOpened(open: boolean): void {
		// Set the opened
		this.opened = open;

		// If the panel opens, show the overlay
		if (open) {
			this._showOverlay();
		}
		// Otherwise, hide the overlay
		else {
			this._hideOverlay();
		}
	}
}
