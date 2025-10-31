/**
 * Data validation utilities
 * Provides comprehensive validation functions for common data types
 */

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
}

/**
 * Validates an email address format
 * Checks for standard RFC 5322 compliant email addresses
 */
export function validateEmail(email: string): ValidationResult {
	const errors: string[] = [];

	if (!email || email.trim() === '') {
		errors.push('Email is required');
	} else {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			errors.push('Invalid email format');
		}

		if (email.length > 254) {
			errors.push('Email is too long (max 254 characters)');
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validates a phone number
 * Supports US and international formats
 */
export function validatePhoneNumber(phone: string, countryCode = 'US'): ValidationResult {
	const errors: string[] = [];

	if (!phone || phone.trim() === '') {
		errors.push('Phone number is required');
	} else {
		// Remove all non-digit characters
		const digitsOnly = phone.replace(/\D/g, '');

		if (countryCode === 'US') {
			if (digitsOnly.length !== 10 && digitsOnly.length !== 11) {
				errors.push('US phone number must be 10 or 11 digits');
			}
		} else {
			if (digitsOnly.length < 7 || digitsOnly.length > 15) {
				errors.push('Phone number must be between 7 and 15 digits');
			}
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validates a password strength
 * Requires minimum length, uppercase, lowercase, number, and special character
 */
export function validatePassword(password: string, minLength = 8): ValidationResult {
	const errors: string[] = [];

	if (!password) {
		errors.push('Password is required');
		return { isValid: false, errors };
	}

	if (password.length < minLength) {
		errors.push(`Password must be at least ${minLength} characters long`);
	}

	if (!/[A-Z]/.test(password)) {
		errors.push('Password must contain at least one uppercase letter');
	}

	if (!/[a-z]/.test(password)) {
		errors.push('Password must contain at least one lowercase letter');
	}

	if (!/[0-9]/.test(password)) {
		errors.push('Password must contain at least one number');
	}

	if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
		errors.push('Password must contain at least one special character');
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validates a credit card number using Luhn algorithm
 * Returns true if the card number is valid
 */
export function validateCreditCard(cardNumber: string): ValidationResult {
	const errors: string[] = [];

	if (!cardNumber || cardNumber.trim() === '') {
		errors.push('Credit card number is required');
		return { isValid: false, errors };
	}

	// Remove spaces and dashes
	const cleaned = cardNumber.replace(/[\s-]/g, '');

	// Check if it's all digits
	if (!/^\d+$/.test(cleaned)) {
		errors.push('Credit card number must contain only digits');
		return { isValid: false, errors };
	}

	// Check length (13-19 digits for most cards)
	if (cleaned.length < 13 || cleaned.length > 19) {
		errors.push('Credit card number must be between 13 and 19 digits');
		return { isValid: false, errors };
	}

	// Luhn algorithm
	let sum = 0;
	let isEven = false;

	for (let i = cleaned.length - 1; i >= 0; i--) {
		let digit = Number.parseInt(cleaned[i]);

		if (isEven) {
			digit *= 2;
			if (digit > 9) {
				digit -= 9;
			}
		}

		sum += digit;
		isEven = !isEven;
	}

	if (sum % 10 !== 0) {
		errors.push('Invalid credit card number (failed Luhn check)');
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validates a URL format
 * Checks for valid protocol, domain, and optional path
 */
export function validateURL(url: string, requireHTTPS = false): ValidationResult {
	const errors: string[] = [];

	if (!url || url.trim() === '') {
		errors.push('URL is required');
		return { isValid: false, errors };
	}

	try {
		const parsed = new URL(url);

		if (requireHTTPS && parsed.protocol !== 'https:') {
			errors.push('URL must use HTTPS protocol');
		}

		if (!parsed.hostname) {
			errors.push('URL must have a valid hostname');
		}
	} catch (error) {
		errors.push('Invalid URL format');
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * Validates a date string and checks if it's in the past or future
 */
export function validateDate(dateString: string, options: { allowPast?: boolean; allowFuture?: boolean } = {}): ValidationResult {
	const errors: string[] = [];
	const { allowPast = true, allowFuture = true } = options;

	if (!dateString || dateString.trim() === '') {
		errors.push('Date is required');
		return { isValid: false, errors };
	}

	const date = new Date(dateString);

	if (Number.isNaN(date.getTime())) {
		errors.push('Invalid date format');
		return { isValid: false, errors };
	}

	const now = new Date();

	if (!allowPast && date < now) {
		errors.push('Date cannot be in the past');
	}

	if (!allowFuture && date > now) {
		errors.push('Date cannot be in the future');
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}
