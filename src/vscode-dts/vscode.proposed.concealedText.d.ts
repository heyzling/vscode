/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/171074
	// https://github.com/microsoft/vscode/issues/286296

	export interface DecorationRenderOptions {
		/**
		 * Conceal the decorated ranges: render something else instead of real text.
		 * Real file context will not change, so it can be copied and searched.
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
		 * What is rendered in place of the concealed text. Defaults to rendering nothing.
		 *
		 * It is drawn in the color and font style of the text it stands for,
		 * unless the options set their own.
		 */
		replacement?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Draw the replacement at the rendered width of the text it stands for.
		 * Width is measured in rendered cells.
		 * Defaults to `false`.
		 */
		preserveWidth?: boolean;

		/**
		 * Where cursor stops near concealed range.
		 * Makes sense only for invisible text.
		 *
		 * - `auto` (default): the stop is the end the caret was travelling towards;
		 *   a caret already at either end stays, and an arrival with no direction falls back to
		 *   the end.
		 * - `before`: in front of the range. Typed characters land in front of the range,
		 * a line break or whitespace behind it.
		 * - `after`: behind the range. Typed characters land behind the range,
		 * a line break or whitespace in front of it.
		 * - `lineStart`: the line, from its first column.
		 * As `after`, but a line break still move concealed range at the start as well.
		 * I.e. typing lands after concealed range, new line lands before.
		 * - `lineEnd`: the line, to its last column.
		 * As `before`, but a line break still move concealed range at the start as well.
		 * I.e. typing lands before concealed range, new line lands after.
		anchor?: 'auto' | 'before' | 'after' | 'lineStart' | 'lineEnd';

		/**
		 * What Backspace, Delete and word-delete do at a concealed range.
		 *
		 * - `atomic` (default): the whole range is deleted, as one undo step.
		 * - `passthrough`: the keys act on the hidden characters as if they were visible. Only
		 *   meaningful with a replacement; with nothing drawn it acts as `atomic`.
		 * - `protect`: deletion never reaches the concealed text; the keys step over the range.
		 * Important for invsible ranges.
		 * - `reveal`: deletion attempt reveals the range and deletes nothing.
		 * Revealed text can be edited.
		 */
		deletionPolicy?: 'atomic' | 'passthrough' | 'protect' | 'reveal';

		/**
		 * Whether an edit reveal concealment. Defaults to `true` as a failsafe.
		 *
		 * A revealed range stays revealed while a caret is inside it or at either end.
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
