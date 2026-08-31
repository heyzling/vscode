/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/171074

	export interface DecorationRenderOptions {
		/**
		 * Conceal the decorated ranges: their text is left out of the rendered view while the
		 * document keeps it. Concealed text holds no cursor positions and is still saved,
		 * searched and copied. Only ranges within a single line are concealed.
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
		 * Line feeds are dropped from `contentText`. The drawn length is capped by the
		 * `editor.conceal.maximumReplacementLength` setting, a cut marked with `…`.
		 */
		replacement?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Draw the replacement at the rendered width of the text it stands for: padded when
		 * narrower, clipped with `…` when wider. Width is measured in rendered cells; the
		 * `editor.conceal.maximumReplacementLength` cap does not apply. Defaults to `false`.
		 */
		preserveWidth?: boolean;

		/**
		 * Which end of the concealed range the one place it collapses to stands for. Only read
		 * when nothing is drawn in its place.
		 *
		 * - `auto` (default): the end the caret is travelling towards. A caret already at either
		 *   end stays; an arrival with no direction falls back to `after`.
		 * - `before`: the range's start. A caret at the other end is moved here.
		 * - `after`: the range's end.
		 */
		cursorStop?: 'auto' | 'before' | 'after';

		/**
		 * What Backspace, Delete and word-delete do at a concealed range.
		 *
		 * - `atomic` (default): the whole range is deleted, as one undo step.
		 * - `passthrough`: the keys act on the hidden characters as if they were visible. Only
		 *   meaningful with a replacement; with nothing drawn it acts as `atomic`.
		 * - `protect`: deletion never reaches the concealed text; the keys step over the range.
		 */
		deletionPolicy?: 'atomic' | 'passthrough' | 'protect';

		/**
		 * Whether an edit inside a concealed range stops it being concealed until the
		 * decoration is applied again. Defaults to `true`.
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
