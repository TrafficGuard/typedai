/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Span, SpanOptions } from '@opentelemetry/api';

/**
 * Options needed for span creation
 */
export interface SugaredSpanOptions extends SpanOptions {
	/**
	 * function to overwrite default exception behavior to record the exception. No exceptions should be thrown in the function.
	 * @param e Error which triggered this exception
	 * @param span current span from context
	 */
	onException?: (e: Error, span: Span) => void;
}
