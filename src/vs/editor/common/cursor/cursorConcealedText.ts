/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { ConcealedTextAnchor, concealedTextCaretStop, ConcealedTextDeletionPolicy, ConcealedTextOptions } from '../model.js';
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

const noConcealedText: readonly LineConcealedText[] = [];

function concealedTextOnLine(model: object, enabled: boolean, lineNumber: number): readonly LineConcealedText[] {
	return enabled && isConcealAwareModel(model) ? model.getLineConcealedText(lineNumber) : noConcealedText;
}

function hasReplacement(options: ConcealedTextOptions): boolean {
	return !!options.replacement && options.replacement.content.length > 0;
}

// Leaving one range can land on the edge of the next.
function settle(column: number, step: (column: number) => number): number {
	for (let next = step(column); next !== column; next = step(column)) {
		column = next;
	}
	return column;
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
	let startColumn = deleteBoundaryOutsideConcealedText(concealedTextOnLine(model, enabled, range.startLineNumber), range.startColumn, false, direction);
	let endColumn = deleteBoundaryOutsideConcealedText(concealedTextOnLine(model, enabled, range.endLineNumber), range.endColumn, true, direction);

	// A caret delete never reaches a protected range, even when a word range covers it whole.
	if (direction !== undefined && range.startLineNumber === range.endLineNumber) {
		for (const concealed of concealedTextOnLine(model, enabled, range.startLineNumber)) {
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
function deleteBoundaryOutsideConcealedText(concealedTexts: readonly LineConcealedText[], column: number, forward: boolean, direction: 'left' | 'right' | undefined): number {
	for (const concealed of concealedTexts) {
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
	const concealedTexts = concealedTextOnLine(model, enabled, position.lineNumber);
	const column = settle(position.column, column => {
		for (const concealed of concealedTexts) {
			if (concealed.options.deletionPolicy !== ConcealedTextDeletionPolicy.Protect) {
				continue;
			}
			if (!forward && column === concealed.endColumn) {
				column = concealed.startColumn;
			} else if (forward && column === concealed.startColumn) {
				column = concealed.endColumn;
			}
		}
		return column;
	});
	return column === position.column ? position : new Position(position.lineNumber, column);
}

/**
 * Moves a column that falls inside a concealed range out to the range's near end, in the given
 * direction. Columns at either end of a range are already outside it.
 */
function columnOutsideConcealedText(concealedTexts: readonly LineConcealedText[], column: number, forward: boolean): number {
	for (const concealed of concealedTexts) {
		if (column > concealed.startColumn && column < concealed.endColumn) {
			return forward ? concealed.endColumn : concealed.startColumn;
		}
	}
	return column;
}

/**
 * The end of a concealed range a caret column belongs on. With a replacement only a column
 * strictly inside moves; with nothing drawn the caret stop decides which end the one place is.
 */
function caretColumnOutsideConcealedText(concealedTexts: readonly LineConcealedText[], column: number): number {
	for (const concealed of concealedTexts) {
		const stop = concealedTextCaretStop(concealed.options);
		const inside = column > concealed.startColumn && column < concealed.endColumn;
		const atOrInside = column >= concealed.startColumn && column <= concealed.endColumn;
		if (hasReplacement(concealed.options) || stop === ConcealedTextAnchor.Auto) {
			// A side per end, or a side resolved when the caret moved: a caret at either end stays.
			if (inside) {
				return concealed.endColumn;
			}
		} else if (atOrInside) {
			return stop === ConcealedTextAnchor.Before ? concealed.startColumn : concealed.endColumn;
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
	if (selectionStart.isEmpty() && selectionStart.getStartPosition().equals(position)) {
		const column = caretColumnOutsideConcealedText(concealedTextOnLine(model, enabled, position.lineNumber), position.column);
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
		? Range.fromPositions(new Position(anchor.lineNumber, columnOutsideConcealedText(concealedTextOnLine(model, enabled, anchor.lineNumber), anchor.column, !positionIsAfterAnchor)))
		: expandOverConcealedText(selectionStart, model, enabled);
	const newColumn = columnOutsideConcealedText(concealedTextOnLine(model, enabled, position.lineNumber), position.column, positionIsAfterAnchor);

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
	const concealedTexts = concealedTextOnLine(model, enabled, position.lineNumber);
	const column = settle(position.column, column => {
		for (const range of concealedTexts) {
			let from: number;
			let to: number;
			if (hasReplacement(range.options)) {
				// Drawn: a caret stop on each side, so only a column strictly inside moves.
				from = range.startColumn + 1;
				to = range.endColumn - 1;
			} else {
				// Nothing drawn: both ends are the same place, so a column on either moves too.
				from = range.startColumn;
				to = range.endColumn;
			}
			if (column >= from && column <= to) {
				column = forward ? range.endColumn : range.startColumn;
			}
		}
		return column;
	});
	return column === position.column ? position : new Position(position.lineNumber, column);
}

/**
 * Where a line break typed at the stop on a concealed range's anchored side goes: past the range,
 * on the far side of the text it belongs to.
 */
export function lineBreakPositionPastConcealedText(position: Position, model: object, enabled: boolean): Position {
	const concealedTexts = concealedTextOnLine(model, enabled, position.lineNumber);
	const column = settle(position.column, column => {
		for (const concealed of concealedTexts) {
			const anchor = concealed.options.anchor ?? ConcealedTextAnchor.Auto;
			if (anchor === ConcealedTextAnchor.After && column === concealed.endColumn) {
				column = concealed.startColumn;
			} else if (anchor === ConcealedTextAnchor.Before && column === concealed.startColumn) {
				column = concealed.endColumn;
			}
		}
		return column;
	});
	return column === position.column ? position : new Position(position.lineNumber, column);
}
