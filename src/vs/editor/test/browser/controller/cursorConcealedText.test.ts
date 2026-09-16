/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CoreEditingCommands, CoreNavigationCommands } from '../../../browser/coreCommands.js';
import { IEditorOptions } from '../../../common/config/editorOptions.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { Selection } from '../../../common/core/selection.js';
import { ConcealedTextAnchor, ConcealedTextDeletionPolicy, ConcealedTextOptions, TrackedRangeStickiness } from '../../../common/model.js';
import { ViewModel } from '../../../common/viewModel/viewModelImpl.js';
import { ITestCodeEditor, withTestCodeEditor } from '../testCodeEditor.js';

function moveTo(editor: ITestCodeEditor, viewModel: ViewModel, lineNumber: number, column: number, inSelectionMode: boolean = false) {
	if (inSelectionMode) {
		CoreNavigationCommands.MoveToSelect.runCoreEditorCommand(viewModel, {
			position: new Position(lineNumber, column)
		});
	} else {
		CoreNavigationCommands.MoveTo.runCoreEditorCommand(viewModel, {
			position: new Position(lineNumber, column)
		});
	}
}

function moveLeft(editor: ITestCodeEditor, viewModel: ViewModel, inSelectionMode: boolean = false) {
	if (inSelectionMode) {
		CoreNavigationCommands.CursorLeftSelect.runCoreEditorCommand(viewModel, {});
	} else {
		CoreNavigationCommands.CursorLeft.runCoreEditorCommand(viewModel, {});
	}
}

function moveRight(editor: ITestCodeEditor, viewModel: ViewModel, inSelectionMode: boolean = false) {
	if (inSelectionMode) {
		CoreNavigationCommands.CursorRightSelect.runCoreEditorCommand(viewModel, {});
	} else {
		CoreNavigationCommands.CursorRight.runCoreEditorCommand(viewModel, {});
	}
}

suite('Editor Controller - Concealed Text', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// `#done` at columns 4..9, drawn as `✅`.
	const LINE = 'is #done by now';
	const TAG = new Range(1, 4, 1, 9);

	// `^ab12cd ` at columns 1..9, nothing drawn.
	const ID_LINE = '^ab12cd note text';
	const ID = new Range(1, 1, 1, 9);

	function withTag(options: IEditorOptions, callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void): void {
		withConcealedRange(LINE, TAG, { replacement: { content: '✅' } }, options, callback);
	}

	function withHiddenId(line: string, range: Range, anchor: ConcealedTextAnchor, callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void): void {
		withConcealedRange(line, range, { anchor }, {}, callback);
	}

	function withConcealedRange(line: string, range: Range, concealedText: ConcealedTextOptions, options: IEditorOptions, callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void): void {
		withTestCodeEditor(line, options, (editor, viewModel) => {
			editor.getModel()!.updateOptions({ tabSize: 3, indentSize: 3, insertSpaces: true });
			editor.getModel()!.deltaDecorations([], [{
				range,
				options: { description: 'test-conceal', concealedText }
			}]);
			callback(editor, viewModel);
		});
	}

	function columnsWhileMoving(editor: ITestCodeEditor, viewModel: ViewModel, steps: number, move: () => void): number[] {
		const columns = [viewModel.getSelection().positionColumn];
		for (let i = 0; i < steps; i++) {
			move();
			columns.push(viewModel.getSelection().positionColumn);
		}
		return columns;
	}

	test('is crossed in one step, the same way in both directions', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 1);
			assert.deepStrictEqual(
				columnsWhileMoving(editor, viewModel, 5, () => moveRight(editor, viewModel)),
				[1, 2, 3, 4, 9, 10],
				'to the right: the tag is one step, from the place in front of it to the place behind'
			);

			moveTo(editor, viewModel, 1, 10);
			assert.deepStrictEqual(
				columnsWhileMoving(editor, viewModel, 5, () => moveLeft(editor, viewModel)),
				[10, 9, 4, 3, 2, 1],
				'to the left: the same, mirrored'
			);
		});
	});

	test('is crossed in one step however long the replacement is', () => {
		// The crossing must not depend on how long the replacement is.
		for (const content of ['✅', '✅ done', 'done']) {
			withConcealedRange(LINE, TAG, { replacement: { content } }, {}, (editor, viewModel) => {
				moveTo(editor, viewModel, 1, 4);
				assert.deepStrictEqual(
					columnsWhileMoving(editor, viewModel, 2, () => moveRight(editor, viewModel)),
					[4, 9, 10],
					`to the right, drawn as ${content}`
				);

				moveTo(editor, viewModel, 1, 9);
				assert.deepStrictEqual(
					columnsWhileMoving(editor, viewModel, 2, () => moveLeft(editor, viewModel)),
					[9, 4, 3],
					`to the left, drawn as ${content}`
				);
			});
		}
	});

	test('holds no position of its own', () => {
		withTag({}, (editor, viewModel) => {
			const landedAt = [5, 6, 8].map(column => {
				moveTo(editor, viewModel, 1, column);
				return viewModel.getSelection().positionColumn;
			});
			assert.deepStrictEqual(landedAt, [9, 9, 9]);
		});
	});

	test('Home stops at the first visible non-blank, then at the line start', () => {
		// `^ab12cd` hidden at columns 1..8: the view line starts with the two spaces, the model line with the id.
		withHiddenId('^ab12cd  text', new Range(1, 1, 1, 8), ConcealedTextAnchor.Auto, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 14);
			assert.deepStrictEqual(viewModel.getCursorStates()[0].viewState.position, new Position(1, 7), 'the caret sits past the range, at a view column short of its model column');
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 10), 'the first non-blank the view shows, not the hidden id');
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 1), 'then the line start, in front of the hidden id');
		});

		withConcealedRange(ID_LINE, ID, { anchor: ConcealedTextAnchor.After }, {}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 14);
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 9), 'an id anchored after keeps its one stop');
		});
	});

	test('leaves a caret aimed at it collapsed', () => {
		// A bare caret, not a selection over the range: Home then Tab used to delete it.
		for (const anchor of [ConcealedTextAnchor.After, ConcealedTextAnchor.Before]) {
			withHiddenId(ID_LINE, ID, anchor, (editor, viewModel) => {
				CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
				assert.strictEqual(viewModel.getSelection().isEmpty(), true, `${anchor}: Home leaves a caret, not a selection`);

				editor.runCommand(CoreEditingCommands.Tab, null);
				assert.ok(editor.getModel()!.getLineContent(1).includes('^ab12cd'), `${anchor}: the id survives an indent at the line start`);
			});
		}
	});

	test('is deleted whole, from either side', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 9);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is  by now', 'backspace after the tag takes all of it');
		});

		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 3);
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is#done by now');
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is by now', 'delete before the tag takes all of it');
		});
	});

	test('is left alone by a delete next to it', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 3);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'i #done by now');
		});
	});

	test('protect: the delete keys take the visible neighbours and step over the range; a selection is deleted as covered', () => {
		// `**bold**` with both markers concealed and protected.
		const withEmphasis = (callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void) => {
			withTestCodeEditor('aa **bold** zz', {}, (editor, viewModel) => {
				editor.getModel()!.deltaDecorations([], [{
					range: new Range(1, 4, 1, 6),
					options: { description: 'test-conceal', concealedText: { anchor: ConcealedTextAnchor.After, deletionPolicy: ConcealedTextDeletionPolicy.Protect } }
				}, {
					range: new Range(1, 10, 1, 12),
					options: { description: 'test-conceal', concealedText: { anchor: ConcealedTextAnchor.Before, deletionPolicy: ConcealedTextDeletionPolicy.Protect } }
				}]);
				callback(editor, viewModel);
			});
		};

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 10);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa **bol** zz', 'Backspace at the visible end takes the letter, never a marker');
		});

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 10);
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa **bold**zz', 'Delete steps over the closing marker and takes the space behind it');
		});

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 6);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa**bold** zz', 'Backspace steps over the opening marker and takes the space in front');
		});

		for (const command of [CoreEditingCommands.DeleteLeft, CoreEditingCommands.DeleteRight]) {
			withEmphasis((editor) => {
				editor.setSelection(new Selection(1, 4, 1, 12));
				editor.runCommand(command, null);
				assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa  zz', `${command.id}: a selection over the construct takes it whole, markers included`);
			});
		}

		withEmphasis((editor) => {
			editor.setSelection(new Selection(1, 1, 1, 8));
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'ld** zz', 'a selection reaching into the construct takes what it covers');
		});
	});

	test('reveal: the delete keys show the range and take nothing, then act on the text they showed', () => {
		const withCall = (callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void) => {
			withConcealedRange('a t("k") z', new Range(1, 3, 1, 9), {
				replacement: { content: 'Key' },
				deletionPolicy: ConcealedTextDeletionPolicy.Reveal,
			}, {}, callback);
		};

		withCall((editor, viewModel) => {
			const model = editor.getModel()!;
			const version = model.getAlternativeVersionId();
			moveTo(editor, viewModel, 1, 9);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(model.getLineContent(1), 'a t("k") z', 'the first Backspace deletes nothing');
			assert.strictEqual(model.getAlternativeVersionId(), version, 'and is not an edit');
			assert.strictEqual(model.getLineConcealedText(1).length, 0, 'the range is revealed');
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 9), 'the caret stays');
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(model.getLineContent(1), 'a t("k" z', 'the second takes the character it showed');
		});

		withCall((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 3);
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'a t("k") z', 'Delete in front reveals');
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'a ("k") z');
		});

		withCall((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 3);
			moveTo(editor, viewModel, 1, 9, true);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'a  z', 'a selection over the range is deleted whole');
		});
	});

	test('reveal with nothing drawn: one key edits the visible neighbour, the other reveals', () => {
		withConcealedRange('a ^ab12cd z', new Range(1, 3, 1, 10), { anchor: ConcealedTextAnchor.Before, deletionPolicy: ConcealedTextDeletionPolicy.Reveal }, {}, (editor, viewModel) => {
			const model = editor.getModel()!;
			moveTo(editor, viewModel, 1, 3);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(model.getLineContent(1), 'a^ab12cd z', 'Backspace at the stop takes the space in front');
			assert.strictEqual(model.getLineConcealedText(1).length, 1);
			editor.runCommand(CoreEditingCommands.DeleteRight, null);
			assert.strictEqual(model.getLineContent(1), 'a^ab12cd z', 'Delete reveals');
			assert.strictEqual(model.getLineConcealedText(1).length, 0);
		});
	});

	test('a range revealed by a delete key stays revealed while the caret is at it, past its owner applying the decoration again', () => {
		withTestCodeEditor('a t("k") z', {}, (editor, viewModel) => {
			const model = editor.getModel()!;
			const decoration = (range: Range) => ({ range, options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, concealedText: { replacement: { content: 'Key' }, deletionPolicy: ConcealedTextDeletionPolicy.Reveal } } });
			let ids = model.deltaDecorations([], [decoration(new Range(1, 3, 1, 9))]);
			moveTo(editor, viewModel, 1, 9);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			ids = model.deltaDecorations(ids, [decoration(new Range(1, 3, 1, 9))]);
			assert.strictEqual(model.getLineConcealedText(1).length, 0, 'applied again with the caret at its end: still revealed');
			viewModel.type('x', 'keyboard');
			assert.strictEqual(model.getLineContent(1), 'a t("k")x z');
			ids = model.deltaDecorations(ids, [decoration(new Range(1, 3, 1, 10))]);
			assert.strictEqual(model.getLineConcealedText(1).length, 0, 'the span grew with the typed character');
			moveTo(editor, viewModel, 1, 1);
			assert.strictEqual(model.getLineConcealedText(1).length, 1, 'the caret left: concealed again');
			moveTo(editor, viewModel, 1, 10);
			assert.strictEqual(model.getLineConcealedText(1).length, 1, 'arriving reveals nothing');
		});
	});

	test('follows the conceal option when it is toggled', () => {
		withTag({}, (editor, viewModel) => {
			editor.updateOptions({ conceal: { enabled: false } });
			moveTo(editor, viewModel, 1, 6);
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 6), 'off: the caret rests inside the tag');
			moveTo(editor, viewModel, 1, 9);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is #don by now', 'off: one character');
		});

		withTag({ conceal: { enabled: false } }, (editor, viewModel) => {
			editor.updateOptions({ conceal: { enabled: true } });
			moveTo(editor, viewModel, 1, 6);
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 9), 'on: the caret leaves the tag');
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is  by now', 'on: the whole tag');
		});
	});

	test('gives a replacement a side of the range for each of its own', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 4);
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is X#done by now', 'in front of the replacement is in front of the tag');
		});

		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 9);
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is #doneX by now', 'behind it is behind the tag');
		});
	});

	test('is taken whole by a selection that reaches into it', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 2);
			moveTo(editor, viewModel, 1, 6, true);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'i by now');
		});
	});

	test('auto: the caret lands on the end it was travelling towards', () => {
		withTestCodeEditor('**Bold**X', {}, (editor, viewModel) => {
			// Pinned, so typing beside a marker cannot grow it.
			editor.getModel()!.deltaDecorations([], [
				{ range: new Range(1, 1, 1, 3), options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, concealedText: {} } },
				{ range: new Range(1, 7, 1, 9), options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, concealedText: {} } },
			]);

			moveTo(editor, viewModel, 1, 10);
			moveLeft(editor, viewModel);
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 7), 'travelling left, the collapsed place stands for the start');

			moveLeft(editor, viewModel);
			moveRight(editor, viewModel);
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 9), 'travelling right, for the end');
		});
	});

	test('auto: a settled caret at a range end survives a directionless re-normalisation', () => {
		withTestCodeEditor('**Bold**X', {}, (editor, viewModel) => {
			// Pinned, so typing beside a marker cannot grow it.
			editor.getModel()!.deltaDecorations([], [
				{ range: new Range(1, 1, 1, 3), options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, concealedText: {} } },
				{ range: new Range(1, 7, 1, 9), options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, concealedText: {} } },
			]);

			moveTo(editor, viewModel, 1, 10);
			moveLeft(editor, viewModel);
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 7), 'the caret settled inside the emphasis');

			editor.updateOptions({ wordWrap: 'wordWrapColumn', wordWrapColumn: 40 });
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 7), 'a wrap change re-normalises with no direction and must not move it');

			viewModel.type('er', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), '**Bolder**X', 'typing extends the emphasis, not the text after it');
		});
	});

	test('with nothing drawn, anchor says which end the one place is', () => {
		withHiddenId(ID_LINE, ID, ConcealedTextAnchor.After, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), '^ab12cd Xnote text', 'typed text goes behind the id');
		});

		withHiddenId(ID_LINE, ID, ConcealedTextAnchor.Before, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'X^ab12cd note text', 'typed text goes in front of the id');
		});
	});

	test('a line break or whitespace typed at a declared stop lands outside the construct', () => {
		// `aa **bold** zz` with both markers concealed: the opening one stops behind itself, the closing one in front.
		const withEmphasis = (callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void) => {
			withTestCodeEditor('aa **bold** zz', {}, (editor, viewModel) => {
				editor.getModel()!.deltaDecorations([], [{
					range: new Range(1, 4, 1, 6),
					options: { description: 'test-conceal', concealedText: { anchor: ConcealedTextAnchor.After, deletionPolicy: ConcealedTextDeletionPolicy.Protect } }
				}, {
					range: new Range(1, 10, 1, 12),
					options: { description: 'test-conceal', concealedText: { anchor: ConcealedTextAnchor.Before, deletionPolicy: ConcealedTextDeletionPolicy.Protect } }
				}]);
				callback(editor, viewModel);
			});
		};

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 10);
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), 'aa **bold**\n zz', 'Enter at the visible end of the emphasis closes it first');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 1));
		});

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 10);
			viewModel.type(' ', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa **bold**  zz', 'a space there separates words outside the emphasis');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 13));
		});

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 6);
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), 'aa \n**bold** zz', 'Enter at the visible start of the emphasis breaks the line in front of it');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 3), 'with the caret still at the start of the word');
		});

		withEmphasis((editor, viewModel) => {
			moveTo(editor, viewModel, 1, 6);
			viewModel.type(' ', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa  **bold** zz', 'a space there goes in front of the emphasis');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 7));
		});

		withConcealedRange('   **bold**', new Range(1, 4, 1, 6), { anchor: ConcealedTextAnchor.After }, {}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 6);
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '   \n   **bold**', 'the moved text keeps the line\'s indentation');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 6));
		});
	});

	test('a line prefix anchored after: text lands behind the range, a line break or indentation in front of it', () => {
		const anchored: ConcealedTextOptions = { anchor: ConcealedTextAnchor.After, deletionPolicy: ConcealedTextDeletionPolicy.Protect };

		withConcealedRange(ID_LINE, ID, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 9), 'the one stop is behind the id');
			assert.deepStrictEqual(viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(1, 1)), new Position(1, 9), 'a click at the line start lands there too');
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), '^ab12cd Xnote text', 'typed text goes behind the id');
			assert.deepStrictEqual(editor.getModel()!.getLineConcealedText(1).map(c => [c.startColumn, c.endColumn]), [[1, 9]], 'and stays visible');
		});

		withConcealedRange(ID_LINE, ID, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '\n^ab12cd note text', 'a line break opens a line above: the id stays with its text');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 9));
		});

		withConcealedRange(ID_LINE, ID, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			editor.runCommand(CoreEditingCommands.Tab, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), '   ^ab12cd note text', 'an indent goes in front of the id');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 12));
			viewModel.type(' ', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), '    ^ab12cd note text', 'so does typed whitespace');
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), '   ^ab12cd note text', 'and Backspace takes it back over the protected id');
		});

		withConcealedRange('   ^ab12cd note', new Range(1, 4, 1, 12), anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '   \n   ^ab12cd note', 'the id and its text move down with the indentation, as the visible text would');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 12), 'with the caret still at the stop');
		});

		withConcealedRange('- ^ab12cd item', new Range(1, 3, 1, 11), anchored, {}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 3);
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 11), 'the one stop is behind the id');
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '- \n^ab12cd item', 'the line breaks at the id: the bullet stays, the id goes down with its text');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 9));
			viewModel.paste('abc\ndef', false);
			assert.strictEqual(editor.getModel()!.getValue(), '- \nabc\n^ab12cd defitem', 'a paste goes in front of the id but for its last line');
		});

		withConcealedRange(ID_LINE, ID, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.paste('abc\ndef', false);
			assert.strictEqual(editor.getModel()!.getValue(), 'abc\n^ab12cd defnote text', 'a paste is split: its last line joins the id\'s text');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 12));
		});
	});

	test('a line suffix anchored to the line end: text and whitespace land in front of the range, a line break behind it', () => {
		// ` ^ab12cd` at columns 10..18, nothing drawn.
		const line = 'note text ^ab12cd';
		const id = new Range(1, 10, 1, 18);
		const anchored: ConcealedTextOptions = { anchor: ConcealedTextAnchor.LineEnd, deletionPolicy: ConcealedTextDeletionPolicy.Protect };

		withConcealedRange(line, id, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorEnd.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 10), 'the one stop is in front of the id');
			moveRight(editor, viewModel);
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 10), 'and there is no place behind it');
			assert.deepStrictEqual(viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(1, 10)), new Position(1, 10), 'a click at the line end lands in front too');
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'note textX ^ab12cd', 'typed text goes in front of the id');
			editor.runCommand(CoreEditingCommands.Tab, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'note textX   ^ab12cd', 'so does an indent');
		});

		withConcealedRange(line, id, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorEnd.runCoreEditorCommand(viewModel, {});
			viewModel.type(' ', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'note text  ^ab12cd', 'typed whitespace stays in front of the id, unlike at a closing delimiter');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 11));
		});

		withConcealedRange(line, id, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorEnd.runCoreEditorCommand(viewModel, {});
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), 'note text ^ab12cd\n', 'a line break leaves the id on its line');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 1));
		});

		withConcealedRange(line, id, anchored, {}, (editor, viewModel) => {
			CoreNavigationCommands.CursorEnd.runCoreEditorCommand(viewModel, {});
			viewModel.paste('abc\r\ndef', false);
			assert.strictEqual(editor.getModel()!.getValue(), 'note textabc ^ab12cd\ndef', 'a paste is split: its first line stays in front of the id');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 4));
		});
	});

	test('a drawn range has a side per end, and keeps the anchor\'s rule for a line break or whitespace typed on the anchored side', () => {
		withConcealedRange(ID_LINE, ID, { replacement: { content: '#' }, anchor: ConcealedTextAnchor.After }, {}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 1);
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 1), 'a drawn badge has a place in front of it');
			moveRight(editor, viewModel);
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 9), 'and one behind it');
			viewModel.type('\n', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '\n^ab12cd note text', 'a line break behind the badge goes in front of the range');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(2, 9));
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getValue(), '\n^ab12cd Xnote text', 'and typed text behind it');
		});

		withConcealedRange('aa **bold** zz', new Range(1, 10, 1, 12), { replacement: { content: '\u203a' }, anchor: ConcealedTextAnchor.Before }, {}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 10);
			viewModel.type(' ', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'aa **bold**  zz', 'a space in front of a drawn closing delimiter lands behind it');
			assert.deepStrictEqual(viewModel.getPosition(), new Position(1, 13));
		});
	});

	test('a concealed decoration never grows when typing at its edges unless told to', () => {
		withHiddenId(ID_LINE, ID, ConcealedTextAnchor.After, (editor, viewModel) => {
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), '^ab12cd Xnote text');
			assert.deepStrictEqual(editor.getModel()!.getLineConcealedText(1).map(c => [c.startColumn, c.endColumn]), [[1, 9]]);
		});

		withTestCodeEditor(ID_LINE, {}, (editor, viewModel) => {
			editor.getModel()!.deltaDecorations([], [{
				range: ID,
				options: { description: 'test-conceal', stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, concealedText: { anchor: ConcealedTextAnchor.After } }
			}]);
			CoreNavigationCommands.CursorHome.runCoreEditorCommand(viewModel, {});
			viewModel.type('X', 'keyboard');
			assert.deepStrictEqual(editor.getModel()!.getLineConcealedText(1).map(c => [c.startColumn, c.endColumn]), [[1, 10]], 'an explicit always-grows stickiness is kept, zero as it is');
		});
	});

	test('with nothing drawn, anchor decides which side a selection stops at', () => {
		withHiddenId(ID_LINE, ID, ConcealedTextAnchor.Before, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 1);
			moveTo(editor, viewModel, 1, 18, true);
			assert.strictEqual(
				editor.getModel()!.getValueInRange(viewModel.getSelection()),
				'^ab12cd note text',
				'selecting the line from its start takes the id with it'
			);
		});

		withHiddenId('   ^ab12cd note', new Range(1, 4, 1, 12), ConcealedTextAnchor.Before, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 1);
			moveTo(editor, viewModel, 1, 4, true);
			assert.strictEqual(
				editor.getModel()!.getValueInRange(viewModel.getSelection()),
				'   ',
				'and selecting up to it stops short of it'
			);
		});
	});

	test('a selection reaching into it from model space takes it whole', () => {
		// A find match, `Ctrl+D` or smart select can hand over a selection ending inside the range.
		const searchHit = new Selection(1, 2, 1, 8); // what `Ctrl+F` for `ab12cd` selects

		for (const anchor of [ConcealedTextAnchor.After, ConcealedTextAnchor.Before]) {
			withHiddenId(ID_LINE, ID, anchor, (editor, viewModel) => {
				editor.setSelection(searchHit);
				assert.deepStrictEqual(
					viewModel.getSelection(),
					new Selection(1, 1, 1, 9),
					`${anchor}: the selection grows to cover the whole id`
				);

				viewModel.type('X', 'keyboard');
				assert.strictEqual(editor.getModel()!.getLineContent(1), 'Xnote text', `${anchor}: and typing over it leaves no half of one behind`);
			});
		}

		withTag({}, (editor, viewModel) => {
			editor.setSelection(new Selection(1, 6, 1, 9));
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(1, 4, 1, 9), 'a replacement makes no difference to this');
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is X by now');
		});
	});

	test('a selection made backwards into it grows the same way', () => {
		withConcealedRange('aa https://a.io bb', new Range(1, 4, 1, 16), { anchor: ConcealedTextAnchor.Before }, {}, (editor, viewModel) => {
			editor.setSelection(new Selection(1, 8, 1, 1));
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(1, 16, 1, 1));
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'X bb');
		});
	});

	test('a paste over such a selection takes it whole too', () => {
		withHiddenId(ID_LINE, ID, ConcealedTextAnchor.Before, (editor, viewModel) => {
			editor.setSelection(new Selection(1, 4, 1, 9));
			viewModel.paste('ZZZ', false);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'ZZZnote text');
		});
	});

	test('copy carries the hidden text, never the replacement', () => {
		withTag({}, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 1);
			moveTo(editor, viewModel, 1, 16, true);
			const copied = viewModel.getPlainTextToCopy([viewModel.getSelection()], false, false);
			assert.strictEqual(copied.sourceText, 'is #done by now');
		});
	});

	test('vertical motion travels by visual column across a concealed line', () => {
		withTestCodeEditor(['is #done by now', 'abcde fgh'], {}, (editor, viewModel) => {
			editor.getModel()!.deltaDecorations([], [{
				range: TAG,
				options: { description: 'test-conceal', concealedText: { replacement: { content: '✅' } } }
			}]);

			// `✅` is two cells wide.
			moveTo(editor, viewModel, 2, 7);
			CoreNavigationCommands.CursorUp.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 10), 'a visible column past the replacement is past the hidden text');

			moveTo(editor, viewModel, 2, 5);
			CoreNavigationCommands.CursorUp.runCoreEditorCommand(viewModel, {});
			assert.deepStrictEqual(viewModel.getSelection().getPosition(), new Position(1, 4), 'a visible column inside the glyph snaps to its near side');
		});
	});

	test('vertical motion lands on the nearer end of a concealed replacement', () => {
		withTestCodeEditor(['aaaaaaaaaaaaaaa', 'is #done by now', 'bbbbbbbbbbbbbbb'], {}, (editor, viewModel) => {
			editor.getModel()!.deltaDecorations([], [{
				range: new Range(2, 4, 2, 9),
				options: { description: 'test-conceal', concealedText: { replacement: { content: '[done]' } } }
			}]);

			// The replacement covers view columns 4 to 9, so its ends are model columns 4 and 9.
			for (const [column, landing] of [[5, 4], [6, 4], [7, 4], [8, 9], [9, 9]]) {
				moveTo(editor, viewModel, 1, column);
				CoreNavigationCommands.CursorDown.runCoreEditorCommand(viewModel, {});
				const down = viewModel.getSelection().positionColumn;

				moveTo(editor, viewModel, 3, column);
				CoreNavigationCommands.CursorUp.runCoreEditorCommand(viewModel, {});
				const up = viewModel.getSelection().positionColumn;

				assert.deepStrictEqual([down, up], [landing, landing], `column ${column} from either direction`);
			}
		});
	});

	test('a caret is put outside a range concealed around it', () => {
		withTestCodeEditor(ID_LINE, {}, (editor, viewModel) => {
			editor.setSelection(new Selection(1, 5, 1, 5));
			editor.getModel()!.deltaDecorations([], [{
				range: ID,
				options: { description: 'test-conceal', concealedText: { anchor: ConcealedTextAnchor.Before } }
			}]);

			assert.deepStrictEqual(viewModel.getSelection(), new Selection(1, 1, 1, 1), 'the caret is moved to the end the range stands for');
			viewModel.type('X', 'keyboard');
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'X^ab12cd note text', 'so what is typed lands outside the id');
		});
	});

	test('is ordinary text again when concealing is turned off', () => {
		withTag({ conceal: { enabled: false } }, (editor, viewModel) => {
			moveTo(editor, viewModel, 1, 4);
			assert.deepStrictEqual(
				columnsWhileMoving(editor, viewModel, 2, () => moveRight(editor, viewModel)),
				[4, 5, 6],
				'every character of the tag is its own position again'
			);

			moveTo(editor, viewModel, 1, 9);
			editor.runCommand(CoreEditingCommands.DeleteLeft, null);
			assert.strictEqual(editor.getModel()!.getLineContent(1), 'is #don by now');
		});
	});
});
