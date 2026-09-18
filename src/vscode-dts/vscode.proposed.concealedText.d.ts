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
		 * Rendered in place of the concealed text. If omitted, or if `contentText` is empty,
		 * nothing is rendered.
		 *
		 * It is drawn: it holds no document position and is never selected or copied. It takes
		 * the color and font style of the text it stands for, unless the options set their own.
		 * Line feeds are dropped from `contentText`.
		 */
		replacement?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Draw the replacement at the rendered width of the text it stands for: padded when
		 * narrower, clipped with `…` when wider. Width is measured in rendered cells, a tab as one.
		 * Defaults to `false`.
		 */
		preserveWidth?: boolean;

		/**
		 * Which text a concealed range belongs to. Fixes the one place the cursor stops at a
		 * range with nothing drawn in its place, and where a line break typed at the stop
		 * lands. Typed characters land at the stop. Defaults to {@link ConcealAnchor.Auto}.
		 *
		 * A range with a replacement has a stop on each side of it; a line break typed at the
		 * stop on the anchor's side still lands past the range. A paste at the stop is split the
		 * same way at its line breaks.
		 */
		anchor?: ConcealAnchor;

		/**
		 * What Backspace, Delete and word-delete do at a concealed range. A selection is deleted
		 * as covered, whatever the policy. Defaults to {@link ConcealDeletionPolicy.Atomic}.
		 */
		deletionPolicy?: ConcealDeletionPolicy;
	}

	/**
	 * Which text a concealed range belongs to.
	 */
	export enum ConcealAnchor {
		/**
		 * Neither side. The stop is the end the cursor was travelling towards; a cursor already
		 * at either end stays, and an arrival with no direction falls back to the end.
		 */
		Auto = 0,
		/**
		 * The text in front of the range, as a closing delimiter or a line suffix. The stop is
		 * the range's start; a line break lands behind the range.
		 */
		Before = 1,
		/**
		 * The text behind the range, as an opening delimiter or a line prefix. The stop is the
		 * range's end; a line break lands in front of the range.
		 */
		After = 2
	}

	/**
	 * What deleting at a concealed range does.
	 */
	export enum ConcealDeletionPolicy {
		/**
		 * The whole range is deleted, as one undo step.
		 */
		Atomic = 0,
		/**
		 * Deletion never reaches the concealed text; the keys step over the range.
		 */
		Protect = 1,
		/**
		 * Deletion only reveals the range and deletes nothing. A revealed range is ordinary text,
		 * so the next press acts on characters that can be seen; it stays revealed while a cursor
		 * is inside it or at either end.
		 */
		Reveal = 2
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
}
