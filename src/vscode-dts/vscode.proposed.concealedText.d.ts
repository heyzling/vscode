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
		 * It is drawn in the color and font style of the text it stands for, unless the options
		 * set their own. Line feeds are dropped from `contentText`. The drawn length is capped by
		 * the `editor.conceal.maximumReplacementLength` setting, a cut marked with `…`.
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
		 *
		 * With {@link ConcealRenderOptions.line}, the same values read as a rule for the seam
		 * where a run of concealed lines meets a visible one, and two more are available:
		 *
		 * - `passthrough` (the default with `line`, rather than `atomic`, which would delete rows
		 *   nobody can see): the lines are joined as written, which changes a concealed line, so it
		 *   stops being concealed.
		 * - `atomic`: the run goes with the join, as one undo step.
		 * - `protect`: the key does nothing.
		 * - `carryBefore`: the visible lines are joined and the run stays right after the text
		 *   above it, for a run that belongs to the line before it.
		 * - `carryAfter`: as `carryBefore`, but the run stays above the joined line, for a run
		 *   that guards the line after it.
		 *
		 * A run is every concealed line next to the seam, whatever decorations hid them. When
		 * they disagree, the least destructive rule wins, and two carries in opposite directions
		 * fall back to `passthrough`.
		 */
		deletionPolicy?: 'atomic' | 'passthrough' | 'protect' | 'carryBefore' | 'carryAfter';

		/**
		 * Whether an edit inside a concealed range stops it being concealed until the
		 * decoration is applied again. Defaults to `true`.
		 */
		revealOnEdit?: boolean;

		/**
		 * Leave the decorated line out of the rendered view. The range is an anchor that
		 * identifies the line; its extent is not consulted. Defaults to `false`.
		 *
		 * The margin keeps the document's numbering. The caret never rests on a concealed
		 * line; it moves to the nearest visible line. At least one line always stays visible.
		 */
		line?: boolean;
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
