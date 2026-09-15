/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../../../base/common/charCode.js';
import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { Selection } from '../core/selection.js';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from '../editorCommon.js';
import { ITextModel } from '../model.js';
import { ReplaceCommand } from './replaceCommand.js';

/**
 * A paste at a concealed range's caret stop, split at a line break so that only the part belonging to the range's text stays at the caret.
 */
export class SplitPasteCommand implements ICommand {

	public static around(position: Position, breakPosition: Position, text: string): ICommand {
		let first: [Position, string];
		let second: [Position, string];
		if (breakPosition.isBefore(position)) {
			// The range leans to the text behind it: the paste's last line joins that text, the rest goes in front.
			const at = text.lastIndexOf('\n') + 1;
			first = [breakPosition, text.substring(0, at)];
			second = [position, text.substring(at)];
		} else {
			// The range leans to the text in front of it: the paste's first line stays there.
			let at = text.indexOf('\n');
			if (at > 0 && text.charCodeAt(at - 1) === CharCode.CarriageReturn) {
				at--;
			}
			first = [position, text.substring(0, at)];
			second = [breakPosition, text.substring(at)];
		}
		if (first[1].length === 0 || second[1].length === 0) {
			return new ReplaceCommand(Range.fromPositions(breakPosition), text);
		}
		return new SplitPasteCommand(first[0], first[1], second[0], second[1]);
	}

	private constructor(
		private readonly _firstPosition: Position,
		private readonly _firstText: string,
		private readonly _secondPosition: Position,
		private readonly _secondText: string
	) { }

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(Range.fromPositions(this._firstPosition), this._firstText);
		builder.addTrackedEditOperation(Range.fromPositions(this._secondPosition), this._secondText);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		return Selection.fromPositions(inverseEditOperations[1].range.getEndPosition());
	}
}
