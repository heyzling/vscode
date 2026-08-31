/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { stateOutsideConcealedText } from '../../../common/cursor/cursorConcealedText.js';
import { ConcealedTextCursorStop } from '../../../common/model.js';
import { LineConcealedText } from '../../../common/textModelEvents.js';

suite('Editor Cursor - concealed text caret normalisation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// One concealed range with nothing drawn, columns 4..9.
	function modelWith(cursorStop: ConcealedTextCursorStop) {
		return { getLineConcealedText: () => [new LineConcealedText(0, 1, 4, 9, { cursorStop })] };
	}

	function normalisedColumn(cursorStop: ConcealedTextCursorStop, column: number): number {
		const position = new Position(1, column);
		const state = stateOutsideConcealedText(Range.fromPositions(position, position), position, modelWith(cursorStop), true);
		return state ? state.position.column : column;
	}

	test('auto moves only a caret strictly inside, so re-normalisation is idempotent', () => {
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.Auto, 6), 9, 'a directionless arrival strictly inside falls back to the end');
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.Auto, 4), 4, 'a caret settled at the start stays');
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.Auto, 9), 9, 'a caret settled at the end stays');
	});

	test('a declared side keeps the inclusive rule, idempotent by construction', () => {
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.Before, 6), 4);
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.Before, 9), 4, 'a caret at the other end is moved to the declared one');
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.After, 4), 9);
		assert.strictEqual(normalisedColumn(ConcealedTextCursorStop.After, 6), 9);
	});
});
