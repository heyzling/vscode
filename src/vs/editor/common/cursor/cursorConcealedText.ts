/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { ConcealedTextCursorStop, ConcealedTextDeletionPolicy, ConcealedTextOptions, PositionAffinity } from '../model.js';
import { Selection } from '../core/selection.js';
import { ICommand, IEditOperationBuilder } from '../editorCommon.js';
import { LineConcealedText } from '../textModelEvents.js';

/**
 * A model that knows which of its text the view conceals.
 */
export interface IConcealAwareModel {
	getLineConcealedText(lineNumber: number): LineConcealedText[];
}

/**
 * A model that knows which of its lines are concealed entirely.
 */
export interface IConcealedLinesAwareModel {
	getConcealedLineRanges(): Range[];
	getLineCount(): number;
	getLineMaxColumn(lineNumber: number): number;
}

function isConcealedLinesAwareModel(model: object): model is IConcealedLinesAwareModel {
	return typeof (model as IConcealedLinesAwareModel).getConcealedLineRanges === 'function';
}

/**
 * Moves a position off a concealed line to the nearest visible line in the direction of travel,
 * or below when there is none. Returns `null` when the position is not on a concealed line.
 */
export function positionOutsideConcealedLines(position: Position, model: object, affinity: PositionAffinity, enabled: boolean): Position | null {
	if (!enabled || !isConcealedLinesAwareModel(model)) {
		return null;
	}
	const ranges = model.getConcealedLineRanges();
	if (ranges.length === 0) {
		return null;
	}
	const hidden = new Set<number>();
	for (const range of ranges) {
		hidden.add(range.startLineNumber);
	}
	if (!hidden.has(position.lineNumber)) {
		return null;
	}
	const lineCount = model.getLineCount();
	const step = affinity === PositionAffinity.Left ? -1 : 1;
	for (const direction of [step, -step]) {
		for (let lineNumber = position.lineNumber + direction; lineNumber >= 1 && lineNumber <= lineCount; lineNumber += direction) {
			if (!hidden.has(lineNumber)) {
				return new Position(lineNumber, Math.min(position.column, model.getLineMaxColumn(lineNumber)));
			}
		}
	}
	// Every line is concealed; the view model guards against this.
	return null;
}

export function isConcealAwareModel(model: object): model is IConcealAwareModel {
	return typeof (model as IConcealAwareModel).getLineConcealedText === 'function';
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
 * covered whole, a passthrough range with a replacement keeps the end, a protected range pushes
 * it back to the boundary. Passthrough with nothing drawn is atomic.
 */
function deleteBoundaryOutsideConcealedText(model: IConcealAwareModel, lineNumber: number, column: number, forward: boolean, direction: 'left' | 'right' | undefined): number {
	for (const concealed of model.getLineConcealedText(lineNumber)) {
		if (!(column > concealed.startColumn && column < concealed.endColumn)) {
			continue;
		}
		const policy = concealed.options.deletionPolicy ?? ConcealedTextDeletionPolicy.Atomic;
		const replacement = concealed.options.replacement;
		if (policy === ConcealedTextDeletionPolicy.Passthrough && replacement && replacement.content.length > 0) {
			return column;
		}
		if (policy === ConcealedTextDeletionPolicy.Protect && direction !== undefined) {
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
 * strictly inside moves; with nothing drawn `cursorStop` decides which end the one place is.
 */
function caretColumnOutsideConcealedText(model: IConcealAwareModel, lineNumber: number, column: number): number {
	for (const concealed of model.getLineConcealedText(lineNumber)) {
		const replacement = concealed.options.replacement;
		if (replacement && replacement.content.length > 0) {
			if (column > concealed.startColumn && column < concealed.endColumn) {
				return concealed.endColumn;
			}
			continue;
		}
		const cursorStop = concealed.options.cursorStop ?? ConcealedTextCursorStop.Auto;
		if (cursorStop === ConcealedTextCursorStop.Auto) {
			// Resolved when the caret moved; a caret already at either end stays, so this is idempotent.
			if (column > concealed.startColumn && column < concealed.endColumn) {
				return concealed.endColumn;
			}
			continue;
		}
		if (column >= concealed.startColumn && column <= concealed.endColumn) {
			return cursorStop === ConcealedTextCursorStop.Before ? concealed.startColumn : concealed.endColumn;
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
			const replacement = range.options.replacement;
			let from: number;
			let to: number;
			if (replacement && replacement.content.length > 0) {
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
 * A model that can be asked about the lines it conceals whole.
 */
export interface IConcealedLineSeamModel extends IConcealedLinesAwareModel {
	getConcealedLineOptions(lineNumber: number): ConcealedTextOptions[];
	getLineContent(lineNumber: number): string;
}

function isConcealedLineSeamModel(model: object): model is IConcealedLineSeamModel {
	return typeof (model as IConcealedLineSeamModel).getConcealedLineOptions === 'function'
		&& isConcealedLinesAwareModel(model);
}

/**
 * A stretch of neighbouring concealed lines, and the one policy that governs it.
 */
interface IConcealedLineRun {
	readonly firstLineNumber: number;
	readonly lastLineNumber: number;
	readonly policy: ConcealedTextDeletionPolicy;
}

/**
 * The policy of a run of lines: the least destructive of them wins, and two carries in opposite
 * directions cancel out.
 */
function runPolicy(model: IConcealedLineSeamModel, firstLineNumber: number, lastLineNumber: number): ConcealedTextDeletionPolicy {
	let protect = false;
	let passthrough = false;
	let carryBefore = false;
	let carryAfter = false;
	for (let lineNumber = firstLineNumber; lineNumber <= lastLineNumber; lineNumber++) {
		for (const options of model.getConcealedLineOptions(lineNumber)) {
			// Not the inline default: deleting rows nobody can see is no way to answer one keypress.
			switch (options.deletionPolicy ?? ConcealedTextDeletionPolicy.Passthrough) {
				case ConcealedTextDeletionPolicy.Protect: protect = true; break;
				case ConcealedTextDeletionPolicy.CarryBefore: carryBefore = true; break;
				case ConcealedTextDeletionPolicy.CarryAfter: carryAfter = true; break;
				case ConcealedTextDeletionPolicy.Passthrough: passthrough = true; break;
			}
		}
	}
	if (protect) {
		return ConcealedTextDeletionPolicy.Protect;
	}
	if (carryBefore !== carryAfter) {
		return carryBefore ? ConcealedTextDeletionPolicy.CarryBefore : ConcealedTextDeletionPolicy.CarryAfter;
	}
	// Both directions, or neither.
	if (carryBefore || passthrough) {
		return ConcealedTextDeletionPolicy.Passthrough;
	}
	return ConcealedTextDeletionPolicy.Atomic;
}

/**
 * The run of concealed lines touching `lineNumber` on the given side, or `null` when the
 * neighbouring line is drawn.
 */
function concealedLineRun(model: IConcealedLineSeamModel, lineNumber: number, direction: -1 | 1): IConcealedLineRun | null {
	const hidden = new Set<number>();
	for (const range of model.getConcealedLineRanges()) {
		hidden.add(range.startLineNumber);
	}
	let edge = lineNumber + direction;
	if (!hidden.has(edge)) {
		return null;
	}
	while (hidden.has(edge + direction)) {
		edge += direction;
	}
	const [firstLineNumber, lastLineNumber] = direction === -1 ? [edge, lineNumber - 1] : [lineNumber + 1, edge];
	return { firstLineNumber, lastLineNumber, policy: runPolicy(model, firstLineNumber, lastLineNumber) };
}

/**
 * What a caret delete does where a visible line meets a run of concealed lines. Returns
 * `undefined` when the position is not at such a seam and the delete is an ordinary one,
 * `null` when the key does nothing, and otherwise the command to run in its place.
 *
 * `direction` is the key: `left` is Backspace at the start of a line, `right` is Delete at the
 * end of one.
 */
export function concealedLineSeamCommand(position: Position, model: object, enabled: boolean, direction: 'left' | 'right'): ICommand | null | undefined {
	if (!enabled || !isConcealedLineSeamModel(model)) {
		return undefined;
	}
	const atStart = direction === 'left' && position.column === 1;
	const atEnd = direction === 'right' && position.column === model.getLineMaxColumn(position.lineNumber);
	if (!atStart && !atEnd) {
		return undefined;
	}
	const run = concealedLineRun(model, position.lineNumber, atStart ? -1 : 1);
	if (!run) {
		return undefined;
	}

	// The two visible lines the seam sits between; the run is what hides between them.
	const aboveLineNumber = atStart ? run.firstLineNumber - 1 : position.lineNumber;
	const belowLineNumber = atStart ? position.lineNumber : run.lastLineNumber + 1;
	if (aboveLineNumber < 1 || belowLineNumber > model.getLineCount()) {
		// Nothing visible to join to.
		return null;
	}

	switch (run.policy) {
		case ConcealedTextDeletionPolicy.Protect:
			return null;
		case ConcealedTextDeletionPolicy.Atomic: {
			// The run goes with the join, in one step.
			const range = new Range(aboveLineNumber, model.getLineMaxColumn(aboveLineNumber), belowLineNumber, 1);
			return new ReplaceCommandThatEndsAt(range, '', new Position(aboveLineNumber, model.getLineMaxColumn(aboveLineNumber)));
		}
		case ConcealedTextDeletionPolicy.CarryBefore:
		case ConcealedTextDeletionPolicy.CarryAfter: {
			const above = model.getLineContent(aboveLineNumber);
			const below = model.getLineContent(belowLineNumber);
			const runLines: string[] = [];
			for (let lineNumber = run.firstLineNumber; lineNumber <= run.lastLineNumber; lineNumber++) {
				runLines.push(model.getLineContent(lineNumber));
			}
			const range = new Range(aboveLineNumber, 1, belowLineNumber, model.getLineMaxColumn(belowLineNumber));
			if (run.policy === ConcealedTextDeletionPolicy.CarryBefore) {
				// The joined line, then the run that belongs to the text above it.
				const text = [above + below, ...runLines].join('\n');
				return new ReplaceCommandThatEndsAt(range, text, new Position(aboveLineNumber, above.length + 1));
			}
			// The run that guards the text below it, then the joined line.
			const text = [...runLines, above + below].join('\n');
			const joinedLineNumber = aboveLineNumber + runLines.length;
			return new ReplaceCommandThatEndsAt(range, text, new Position(joinedLineNumber, above.length + 1));
		}
		default:
			return undefined;
	}
}

/**
 * A replace whose caret lands where the caller says, not at the end of what it wrote.
 */
class ReplaceCommandThatEndsAt implements ICommand {

	constructor(
		private readonly _range: Range,
		private readonly _text: string,
		private readonly _caret: Position
	) { }

	public getEditOperations(model: unknown, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text);
	}

	public computeCursorState(model: unknown, helper: unknown): Selection {
		return Selection.fromPositions(this._caret);
	}
}
