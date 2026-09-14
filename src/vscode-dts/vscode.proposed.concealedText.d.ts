/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/171074

	// Concealing whole lines is out of scope here. A hidden row raises questions this API does
	// not answer: what a deletion does at the seam between hidden and visible rows, and what the
	// line-wise commands operate on. That work is kept on the `conceal-1.135-lines` branch.

	export interface DecorationRenderOptions {
		/**
		 * Conceal the decorated ranges: their text is left out of the rendered view while the
		 * document keeps it. Concealed text holds no cursor positions and is still saved,
		 * searched and copied. Only ranges within a single line are concealed.
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
		 * Rendered in place of the concealed text. It is drawn, not inserted: it is part of no
		 * document position and is never selected or copied. Defaults to rendering nothing.
		 *
		 * It is drawn in the color and font style of the text it stands for, unless the options
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
		 * Which text the concealed range belongs to. It decides which end of the range its one
		 * caret stop stands for, where characters typed at that stop land, and where a line
		 * break or whitespace typed there goes.
		 *
		 * - `auto` (default): neither side. The stop is the end the caret was travelling towards;
		 *   a caret already at either end stays, and an arrival with no direction falls back to
		 *   the end. Everything typed there lands at the stop.
		 * - `before`: the text in front of the range, as a closing delimiter. The stop is the
		 *   range's start: typed characters land in front of the range, a line break or
		 *   whitespace behind it, so `**bold**` closes before the line breaks.
		 * - `after`: the text behind the range, as an opening delimiter. The stop is the range's
		 *   end: typed characters land behind the range, a line break or whitespace in front of
		 *   it.
		 * - `lineStart`: the line, from its first column. As `after`, but a line break typed at
		 *   the stop goes in front of the whole line, which moves down with the caret still at
		 *   the stop; the range keeps the first column of its text.
		 * - `lineEnd`: the line, to its last column. As `before`, but whitespace typed at the
		 *   stop stays in front of the range, so nothing follows it on its line.
		 *
		 * `auto`, `before` and `after` are read only when nothing is drawn in the range's place,
		 * since a replacement has a side per end; `lineStart` and `lineEnd` apply drawn or not.
		 * A paste at the stop is split the same way at its line breaks. A join of two lines does
		 * not move the range. `deletionPolicy: 'protect'` keeps the delete keys off it.
		 */
		anchor?: 'auto' | 'before' | 'after' | 'lineStart' | 'lineEnd';

		/**
		 * What Backspace, Delete and word-delete do at a concealed range.
		 *
		 * - `atomic` (default): the whole range is deleted, as one undo step.
		 * - `passthrough`: the keys act on the hidden characters as if they were visible. Only
		 *   meaningful with a replacement; with nothing drawn it acts as `atomic`.
		 * - `protect`: deletion never reaches the concealed text; the keys step over the range.
		 * - `reveal`: the key reveals the range and deletes nothing. A revealed range is ordinary
		 *   text, so the next press acts on characters that can be seen.
		 */
		deletionPolicy?: 'atomic' | 'passthrough' | 'protect' | 'reveal';

		/**
		 * Whether an edit inside a concealed range stops it being concealed. Defaults to `true`.
		 *
		 * A revealed range stays revealed while a caret is inside it or at either end. One revealed
		 * by an edit also stays revealed until the decoration is applied again.
		 */
		revealOnEdit?: boolean;
	}

	export interface DecorationInstanceRenderOptions {
		/**
		 * Conceal options for this range alone, overriding the decoration type's.
		 *
		 * For performance reasons, keep the number of decoration specific options small, and
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
