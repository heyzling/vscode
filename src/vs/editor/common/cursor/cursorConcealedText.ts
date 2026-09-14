/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { ConcealedTextAnchor, ConcealedTextDeletionPolicy, ConcealedTextOptions } from '../model.js';
import { LineConcealedText } from '../textModelEvents.js';

/**
 * A model that knows which of its text the view conceals.
 */
export interface IConcealAwareModel {
	getLineConcealedText(lineNumber: number): LineConcealedText[];
	revealConcealedText(lineNumber: number, startColumn: number, endColumn: number): void;
}

export function isConcealAwareModel(model: object): model is IConcealAwareModel {
	return typeof (model as IConcealAwareModel).getLineConcealedText === 'function';
}

function hasReplacement(options: ConcealedTextOptions): boolean {
	return !!options.replacement && options.replacement.content.length > 0;
}

/**
 * Whether the range is line metadata, with one caret stop drawn or not.
 */
function isLineAnchored(options: ConcealedTextOptions): boolean {
	return options.anchor === ConcealedTextAnchor.LineStart || options.anchor === ConcealedTextAnchor.LineEnd;
}

/**
 * Reveals the `reveal` ranges a caret delete reaches into, in place of the delete. Returns whether
 * any was, in which case the delete is refused.
 */
export function revealConcealedTextInsteadOfDeleting(range: Range, model: object, enabled: boolean): boolean {
	if (!enabled || !isConcealAwareModel(model)) {
		return false;
	}
	let revealed = false;
	for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber++) {
		const startColumn = lineNumber === range.startLineNumber ? range.startColumn : 1;
		const endColumn = lineNumber === range.endLineNumber ? range.endColumn : Number.MAX_SAFE_INTEGER;
		for (const concealed of model.getLineConcealedText(lineNumber)) {
			if (concealed.options.deletionPolicy !== ConcealedTextDeletionPolicy.Reveal) {
				continue;
			}
			if (startColumn < concealed.endColumn && endColumn > concealed.startColumn) {
				model.revealConcealedText(lineNumber, concealed.startColumn, concealed.endColumn);
				revealed = true;
			}
		}
	}
	return revealed;
}

/**
 * Adjusts a delete range for the concealed ranges it reaches into, by each range's deletion
 * policy. `direction` is the caret delete's direction; a selection delete has none.
 */
export function expandOverConcealedText(range: Range, model: object, enabled: boolean, direction?: 'left' | 'right'): Range {
	if (!enabled || !isConcealAwareModel(model)) {
		return range;
	}

	let startColumn = deleteBoundaryOutsideConcealedText(model, range.startLineNumber, range.startColumn, false, direction);
	let endColumn = deleteBoundaryOutsideConcealedText(model, range.endLineNumber, range.endColumn, true, direction);

	// A caret delete never reaches a protected range, even when a word range covers it whole.
	if (direction !== undefined && range.startLineNumber === range.endLineNumber) {
		for (const concealed of model.getLineConcealedText(range.startLineNumber)) {
			if (concealed.options.deletionPolicy !== ConcealedTextDeletionPolicy.Protect) {
				continue;
			}
			if (concealed.startColumn >= startColumn && concealed.endColumn <= endColumn) {
				if (direction === 'left') {
					startColumn = Math.max(startColumn, concealed.endColumn);
				} else {
					endColumn = Math.min(endColumn, concealed.startColumn);
				}
			}
		}
	}

	if (startColumn === range.startColumn && endColumn === range.endColumn) {
		return range;
	}
	return new Range(range.startLineNumber, startColumn, range.endLineNumber, endColumn);
}

/**
 * Where one end of a delete lands when it falls inside a concealed range: an atomic range is
 * covered whole, a protected range pushes it back to the boundary.
 */
function deleteBoundaryOutsideConcealedText(model: IConcealAwareModel, lineNumber: number, column: number, forward: boolean, direction: 'left' | 'right' | undefined): number {
	for (const concealed of model.getLineConcealedText(lineNumber)) {
		if (!(column > concealed.startColumn && column < concealed.endColumn)) {
			continue;
		}
		if (concealed.options.deletionPolicy === ConcealedTextDeletionPolicy.Protect && direction !== undefined) {
			return forward ? concealed.startColumn : concealed.endColumn;
		}
		return forward ? concealed.endColumn : concealed.startColumn;
	}
	return column;
}

/**
 * Hops a caret delete's position across the protected concealed ranges it would otherwise reach into.
 */
export function positionPastProtectedConcealedText(position: Position, model: object, forward: boolean, enabled: boolean): Position {
	if (!enabled || !isConcealAwareModel(model)) {
		return position;
	}
	let column = position.column;
	let hopped = true;
	while (hopped) {
		hopped = false;
		for (const concealed of model.getLineConcealedText(position.lineNumber)) {
			if (concealed.options.deletionPolicy !== ConcealedTextDeletionPolicy.Protect) {
				continue;
			}
			if (!forward && column === concealed.endColumn) {
				column = concealed.startColumn;
				hopped = true;
			} else if (forward && column === concealed.startColumn) {
				column = concealed.endColumn;
				hopped = true;
			}
		}
	}
	if (column === position.column) {
		return position;
	}
	return new Position(position.lineNumber, column);
}

/**
 * Moves a column that falls inside a concealed range out to the range's near end, in the given
 * direction. Columns at either end of a range are already outside it.
 */
function columnOutsideConcealedText(model: IConcealAwareModel, lineNumber: number, column: number, forward: boolean): number {
	for (const concealed of model.getLineConcealedText(lineNumber)) {
		if (column > concealed.startColumn && column < concealed.endColumn) {
			return forward ? concealed.endColumn : concealed.startColumn;
		}
	}
	return column;
}

/**
 * The end of a concealed range a caret column belongs on. With a replacement only a column
 * strictly inside moves; with nothing drawn the anchor decides which end the one place is.
 */
function caretColumnOutsideConcealedText(model: IConcealAwareModel, lineNumber: number, column: number): number {
	for (const concealed of model.getLineConcealedText(lineNumber)) {
		const anchor = concealed.options.anchor ?? ConcealedTextAnchor.Auto;
		const inside = column > concealed.startColumn && column < concealed.endColumn;
		const atOrInside = column >= concealed.startColumn && column <= concealed.endColumn;
		if (isLineAnchored(concealed.options)) {
			// One stop on the side of the range's text, drawn or not.
			if (atOrInside) {
				return anchor === ConcealedTextAnchor.LineStart ? concealed.endColumn : concealed.startColumn;
			}
			continue;
		}
		if (hasReplacement(concealed.options) || anchor === ConcealedTextAnchor.Auto) {
			// A side per end, or a side resolved when the caret moved: a caret at either end stays.
			if (inside) {
				return concealed.endColumn;
			}
			continue;
		}
		if (atOrInside) {
			return anchor === ConcealedTextAnchor.Before ? concealed.startColumn : concealed.endColumn;
		}
	}
	return column;
}

/**
 * Keeps a cursor out of concealed text: a caret goes to the end its range collapses to, and a
 * selection's ends move outward so it never cuts a concealed range in half. Returns `null` when
 * nothing moved.
 */
export function stateOutsideConcealedText(selectionStart: Range, position: Position, model: object, enabled: boolean): { selectionStart: Range; position: Position } | null {
	if (!enabled || !isConcealAwareModel(model)) {
		return null;
	}

	if (selectionStart.isEmpty() && selectionStart.getStartPosition().equals(position)) {
		const column = caretColumnOutsideConcealedText(model, position.lineNumber, position.column);
		if (column === position.column) {
			return null;
		}
		const caret = new Position(position.lineNumber, column);
		return { selectionStart: Range.fromPositions(caret), position: caret };
	}

	// The anchor is the end the selection is drawn from, see `SingleCursorState._computeSelection`.
	const anchor = (selectionStart.isEmpty() || !position.isBeforeOrEqual(selectionStart.getStartPosition()))
		? selectionStart.getStartPosition()
		: selectionStart.getEndPosition();
	const positionIsAfterAnchor = !position.isBefore(anchor);

	const newSelectionStart = selectionStart.isEmpty()
		? Range.fromPositions(new Position(anchor.lineNumber, columnOutsideConcealedText(model, anchor.lineNumber, anchor.column, !positionIsAfterAnchor)))
		: expandOverConcealedText(selectionStart, model, enabled);
	const newColumn = columnOutsideConcealedText(model, position.lineNumber, position.column, positionIsAfterAnchor);

	if (newColumn === position.column && newSelectionStart.equalsRange(selectionStart)) {
		return null;
	}
	return { selectionStart: newSelectionStart, position: new Position(position.lineNumber, newColumn) };
}

/**
 * Moves a word-navigation position out of a concealed range by the end the move is heading
 * for, so the range is one step to cross.
 */
export function positionOutsideConcealedText(position: Position, model: object, forward: boolean, enabled: boolean): Position {
	if (!enabled || !isConcealAwareModel(model)) {
		return position;
	}

	const concealed = model.getLineConcealedText(position.lineNumber);
	let column = position.column;
	// Leaving one range can land on the edge of the next.
	for (let moved = true; moved;) {
		moved = false;
		for (const range of concealed) {
			let from: number;
			let to: number;
			if (hasReplacement(range.options) && !isLineAnchored(range.options)) {
				// Drawn: a caret stop on each side, so only a column strictly inside moves.
				from = range.startColumn + 1;
				to = range.endColumn - 1;
			} else {
				// Nothing drawn: both ends are the same place, so a column on either moves too.
				from = range.startColumn;
				to = range.endColumn;
			}
			if (column < from || column > to) {
				continue;
			}
			const end = forward ? range.endColumn : range.startColumn;
			if (end !== column) {
				column = end;
				moved = true;
			}
		}
	}

	return column === position.column ? position : new Position(position.lineNumber, column);
}

/**
 * Where a line break or whitespace typed at a concealed range's caret stop goes: past the range,
 * outside the text it belongs to. At line metadata a line break goes in front of the whole line
 * for a line-start range and behind a line-end one, and whitespace is indentation, in front of a
 * line-start range and left at a line-end one.
 */
export function positionPastConcealedTextFor(edit: 'lineBreak' | 'whitespace', position: Position, model: object, enabled: boolean): Position {
	if (!enabled || !isConcealAwareModel(model)) {
		return position;
	}
	let column = position.column;
	let lineStart = false;
	// Leaving one range can land on the stop of the next.
	for (let moved = true; moved;) {
		moved = false;
		for (const concealed of model.getLineConcealedText(position.lineNumber)) {
			const anchor = concealed.options.anchor ?? ConcealedTextAnchor.Auto;
			if (anchor === ConcealedTextAnchor.LineStart && column === concealed.endColumn) {
				column = concealed.startColumn;
				lineStart = moved = true;
			} else if (anchor === ConcealedTextAnchor.LineEnd && edit === 'lineBreak' && column === concealed.startColumn) {
				column = concealed.endColumn;
				moved = true;
			} else if (!hasReplacement(concealed.options)) {
				if (anchor === ConcealedTextAnchor.After && column === concealed.endColumn) {
					column = concealed.startColumn;
					moved = true;
				} else if (anchor === ConcealedTextAnchor.Before && column === concealed.startColumn) {
					column = concealed.endColumn;
					moved = true;
				}
			}
		}
	}
	if (lineStart && edit === 'lineBreak') {
		// The line moves down whole, with any prefix in front of the range.
		column = 1;
	}
	return column === position.column ? position : new Position(position.lineNumber, column);
}
