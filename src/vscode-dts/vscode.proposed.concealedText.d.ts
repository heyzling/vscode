/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/171074
	// https://github.com/microsoft/vscode/issues/286296

	export interface DecorationRenderOptions {
		/**
		 * Conceal the decorated ranges: something else, or nothing, is rendered in place of their
		 * text. The document keeps the text, so it is still saved, searched and copied. Concealed
		 * text holds no cursor positions.
		 *
		 * Only ranges within a single line are concealed.
		 *
		 * Unless `rangeBehavior` is set, the ranges never grow when typing at their edges.
		 */
		conceal?: ConcealRenderOptions;
	}

	/**
	 * Represents rendering styles for concealed text.
	 */
	export interface ConcealRenderOptions {
		/**
		 * Rendered in place of the concealed text.
		 * If omitted, or if `contentText` is empty, nothing is rendered
		 *
		 * It is drawn: it holds no document position and is never selected or
		 * copied. It takes the color and font style of the text it stands for, unless the options
		 * set their own. Line feeds are dropped from `contentText`.
		 */
		replacement?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Draw the replacement at the rendered width of the text it stands for: padded when
		 * narrower, clipped with `…` when wider. Width is measured in rendered cells.
		 * Defaults to `false`.
		 */
		preserveWidth?: boolean;

		/**
		 * Where the cursor stops at a concealed range, and where a line break or whitespace typed
		 * at that stop lands. Typed characters land at the stop.
		 *
		 * - `auto` (default): the stop is the end the cursor was travelling towards; a cursor
		 *   already at either end stays, and an arrival with no direction falls back to the end.
		 * - `before`: the stop is the range's start. A line break or whitespace lands behind the
		 *   range.
		 * - `after`: the stop is the range's end. A line break or whitespace lands in front of the
		 *   range.
		 * - `lineStart`: as `after`, but a line break moves the whole line down
		 * and whitespace lands in front of the range.
		 * - `lineEnd`: as `before`, but whitespace stays in front of the range, so nothing follows it on its line.
		 *
		 * `auto`, `before` and `after` are read only when nothing is drawn in the range's place,
		 * since a replacement has a side per end; `lineStart` and `lineEnd` apply drawn or not.
		 * A paste at the stop is split the same way at its line breaks.
		 */
		anchor?: 'auto' | 'before' | 'after' | 'lineStart' | 'lineEnd';

		/**
		 * What Backspace, Delete and word-delete do at a concealed range.
		 *
		 * - `atomic` (default): the whole range is deleted, as one undo step.
		 * - `protect`: deletion never reaches the concealed text; the keys step over the range.
		 * - `reveal`: deletion only reveals the range and deletes nothing. A revealed range is ordinary
		 *   text, so the next press acts on characters that can be seen; it stays revealed while a
		 *   cursor is inside it or at either end.
		 */
		deletionPolicy?: 'atomic' | 'protect' | 'reveal';
	}

	export interface DecorationInstanceRenderOptions {
		/**
		 * Conceal options for this range alone, overriding the decoration type's.
		 *
		 * For performance reasons, keep the number of decoration-specific options small, and
		 * use decoration types wherever possible.
		 */
		conceal?: ConcealInstanceRenderOptions;
	}

	export interface ConcealInstanceRenderOptions {
		/**
		 * Rendered in place of *this* range, overriding the decoration type's replacement.
		 */
		replacement?: ThemableDecorationAttachmentRenderOptions;
	}

	export interface ThemableDecorationAttachmentRenderOptions {
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		borderRadius?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		fontSize?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		fontFamily?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		opacity?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		padding?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		verticalAlign?: string;
	}
}
