import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'safeHtml',
  standalone: true,
})
export class SafeHtmlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    // Ensure that null or undefined values are handled gracefully, returning an empty string for sanitization.
    return this.sanitizer.bypassSecurityTrustHtml(value || '');
  }
}
