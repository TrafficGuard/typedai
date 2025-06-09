import { Injectable } from '@angular/core';

/**
 * Basic logger service placeholder.
 * Replace with actual implementation if available.
 */
@Injectable({
    providedIn: 'root',
})
export class Logger {
    debug(message?: any, ...optionalParams: any[]): void {
        console.debug(message, ...optionalParams);
    }

    error(message?: any, ...optionalParams: any[]): void {
        console.error(message, ...optionalParams);
    }

    info(message?: any, ...optionalParams: any[]): void {
        console.info(message, ...optionalParams);
    }

    warn(message?: any, ...optionalParams: any[]): void {
        console.warn(message, ...optionalParams);
    }
}
