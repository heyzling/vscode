/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../base/common/assert.js';
import { Lazy } from '../../base/common/lazy.js';
import * as strings from '../../base/common/strings.js';
import { Constants } from '../../base/common/uint.js';
import { WrappingIndent } from './config/editorOptions.js';
import { FontInfo } from './config/fontInfo.js';
import { Position } from './core/position.js';
import { OffsetRange } from './core/ranges/offsetRange.js';
import { ConcealedTextCursorStop, InjectedTextCursorStops, InjectedTextOptions, PositionAffinity } from './model.js';
import { LineConcealedText, LineInjectedText } from './textModelEvents.js';

/**
 * *input*:
 * ```
 * xxxxxxxxxxxxxxxxxxxxxxxxxxx
 * ```
 *
 * -> Applying injections `[i...i]`, *inputWithInjections*:
 * ```
 * xxxxxx[iiiiiiiiii]xxxxxxxxxxxxxxxxx[ii]xxxx
 * ```
 *
 * -> breaking at offsets `|` in `xxxxxx[iiiiiii|iii]xxxxxxxxxxx|xxxxxx[ii]xxxx|`:
 * ```
 * xxxxxx[iiiiiii
 * iii]xxxxxxxxxxx
 * xxxxxx[ii]xxxx
 * ```
 *
 * -> applying wrappedTextIndentLength, *output*:
 * ```
 * xxxxxx[iiiiiii
 *    iii]xxxxxxxxxxx
 *    xxxxxx[ii]xxxx
 * ```
 *
 * Concealed ranges `(c...c)` are removed before breaking, so *inputWithInjections* holds neither
 * their characters nor offsets of their own: `xxx(cccc)xxx` becomes `xxxxxx`. A replacement
 * injected at the range start gives that place a left and a right side.
 */
export class ModelLineProjectionData {
	constructor(
		public injectionOffsets: number[] | null,
		/**
		 * `injectionOptions.length` must equal `injectionOffsets.length`
		 */
		public injectionOptions: InjectedTextOptions[] | null,
		/**
		 * Refers to offsets after applying injections to the source.
		 * The last break offset indicates the length of the source after applying injections.
		 */
		public breakOffsets: number[],
		/**
		 * Refers to offsets after applying injections
		 */
		public breakOffsetsVisibleColumn: number[],
		public wrappedTextIndentLength: number,
		/**
		 * Offsets in the source of the ranges concealed in the view, sorted and non-overlapping.
		 * No injection may start strictly inside one of these ranges.
		 */
		public concealOffsets: number[] | null = null,
		/**
		 * `concealLengths.length` must equal `concealOffsets.length`
		 */
		public concealLengths: number[] | null = null,
		/**
		 * For each concealed range, which end its collapsed place stands for. A range with a
		 * replacement carries {@link ConcealedTextCursorStop.After}.
		 *
		 * `concealStops.length` must equal `concealOffsets.length`
		 */
		public concealStops: ConcealedTextCursorStop[] | null = null
	) {
	}

	private get _injectionCount(): number {
		return this.injectionOffsets?.length ?? 0;
	}

	private get _concealCount(): number {
		return this.concealOffsets?.length ?? 0;
	}

	public getOutputLineCount(): number {
		return this.breakOffsets.length;
	}

	/**
	 * The injection offsets in the line without its concealed ranges, the space tokens and
	 * inline decorations are computed in.
	 */
	public getInjectionOffsetsWithoutConcealedText(): number[] | null {
		if (this.injectionOffsets === null || this.concealOffsets === null) {
			return this.injectionOffsets;
		}

		const result: number[] = [];
		let concealIndex = 0;
		let concealedLengthBefore = 0;
		for (const injectionOffset of this.injectionOffsets) {
			// A range starting exactly here has not been passed yet.
			while (concealIndex < this._concealCount && this.concealOffsets[concealIndex] < injectionOffset) {
				concealedLengthBefore += this.concealLengths![concealIndex];
				concealIndex++;
			}
			result.push(injectionOffset - concealedLengthBefore);
		}
		return result;
	}

	/**
	 * Whether this injected text is a concealed range's replacement, injected at the range start.
	 */
	private standsForConcealedText(injectionIndex: number): boolean {
		if (this.concealOffsets === null || this.injectionOffsets === null) {
			return false;
		}
		return this.concealOffsets.indexOf(this.injectionOffsets[injectionIndex]) !== -1;
	}

	/**
	 * The concealed ranges of the line, as offsets into the model line.
	 */
	public getConcealedRanges(): OffsetRange[] | null {
		if (this.concealOffsets === null) {
			return null;
		}
		return this.concealOffsets.map((offset, idx) => new OffsetRange(offset, offset + this.concealLengths![idx]));
	}

	public getMinOutputOffset(outputLineIndex: number): number {
		if (outputLineIndex > 0) {
			return this.wrappedTextIndentLength;
		}
		return 0;
	}

	public getLineLength(outputLineIndex: number): number {
		// These offsets refer to model text with injected text.
		const startOffset = outputLineIndex > 0 ? this.breakOffsets[outputLineIndex - 1] : 0;
		const endOffset = this.breakOffsets[outputLineIndex];

		let lineLength = endOffset - startOffset;
		if (outputLineIndex > 0) {
			lineLength += this.wrappedTextIndentLength;
		}
		return lineLength;
	}

	public getMaxOutputOffset(outputLineIndex: number): number {
		return this.getLineLength(outputLineIndex);
	}

	public translateToInputOffset(outputLineIndex: number, outputOffset: number, affinity: PositionAffinity = PositionAffinity.None): number {
		if (outputLineIndex > 0) {
			outputOffset = Math.max(0, outputOffset - this.wrappedTextIndentLength);
		}

		const offsetInInputWithInjection = outputLineIndex === 0 ? outputOffset : this.breakOffsets[outputLineIndex - 1] + outputOffset;

		if (this.concealOffsets === null) {
			let offsetInInput = offsetInInputWithInjection;
			if (this.injectionOffsets !== null) {
				for (let i = 0; i < this.injectionOffsets.length; i++) {
					if (offsetInInput > this.injectionOffsets[i]) {
						if (offsetInInput < this.injectionOffsets[i] + this.injectionOptions![i].content.length) {
							// `inputOffset` is within injected text
							offsetInInput = this.injectionOffsets[i];
						} else {
							offsetInInput -= this.injectionOptions![i].content.length;
						}
					} else {
						break;
					}
				}
			}
			return offsetInInput;
		}

		// Walk the source and the source with injections side by side, in source order.
		let inputOffset = 0;
		let offsetSoFar = 0;
		let injectionIndex = 0;
		let concealIndex = 0;

		while (injectionIndex < this._injectionCount || concealIndex < this._concealCount) {
			const injectionOffset = injectionIndex < this._injectionCount ? this.injectionOffsets![injectionIndex] : Constants.MAX_SAFE_SMALL_INTEGER;
			const concealOffset = concealIndex < this._concealCount ? this.concealOffsets![concealIndex] : Constants.MAX_SAFE_SMALL_INTEGER;
			const nextOffset = Math.min(injectionOffset, concealOffset);

			// The text in between is mapped one to one.
			if (offsetInInputWithInjection < offsetSoFar + (nextOffset - inputOffset)) {
				return inputOffset + (offsetInInputWithInjection - offsetSoFar);
			}
			offsetSoFar += nextOffset - inputOffset;
			inputOffset = nextOffset;

			if (injectionOffset <= concealOffset) {
				const injectionLength = this.injectionOptions![injectionIndex].content.length;
				if (offsetInInputWithInjection < offsetSoFar + injectionLength) {
					// At or within injected text, which has no source offset of its own.
					return inputOffset;
				}
				offsetSoFar += injectionLength;
				injectionIndex++;
			} else {
				// Both ends of the range are at `offsetSoFar`; `concealStops` says which one the
				// place means. `Auto` resolves by travel direction and falls back to the end.
				if (offsetInInputWithInjection === offsetSoFar) {
					const stop = this.concealStops?.[concealIndex];
					if (stop === ConcealedTextCursorStop.Before
						|| (stop === ConcealedTextCursorStop.Auto && affinity === PositionAffinity.Left)) {
						return inputOffset;
					}
				}
				inputOffset += this.concealLengths![concealIndex];
				concealIndex++;
			}
		}

		return inputOffset + (offsetInInputWithInjection - offsetSoFar);
	}

	public translateToOutputPosition(inputOffset: number, affinity: PositionAffinity = PositionAffinity.None): OutputPosition {
		let inputOffsetInInputWithInjection = inputOffset;
		let injectionIndex = 0;
		let concealIndex = 0;

		while (injectionIndex < this._injectionCount || concealIndex < this._concealCount) {
			const injectionOffset = injectionIndex < this._injectionCount ? this.injectionOffsets![injectionIndex] : Constants.MAX_SAFE_SMALL_INTEGER;
			const concealOffset = concealIndex < this._concealCount ? this.concealOffsets![concealIndex] : Constants.MAX_SAFE_SMALL_INTEGER;

			if (injectionOffset <= concealOffset) {
				if (inputOffset < injectionOffset) {
					break;
				}

				// A replacement's near side is the range start, a position of its own; affinity
				// must not carry the caret past it.
				const standsForConcealedText = injectionOffset === concealOffset;
				if ((affinity !== PositionAffinity.Right || standsForConcealedText) && inputOffset === injectionOffset) {
					break;
				}

				inputOffsetInInputWithInjection += this.injectionOptions![injectionIndex].content.length;
				injectionIndex++;
			} else {
				if (inputOffset <= concealOffset) {
					break;
				}

				const concealLength = this.concealLengths![concealIndex];
				if (inputOffset < concealOffset + concealLength) {
					// Inside the concealed range: collapses onto its end.
					inputOffsetInInputWithInjection -= inputOffset - concealOffset;
					break;
				}

				inputOffsetInInputWithInjection -= concealLength;
				concealIndex++;
			}
		}

		return this.offsetInInputWithInjectionsToOutputPosition(inputOffsetInInputWithInjection, affinity);
	}

	private offsetInInputWithInjectionsToOutputPosition(offsetInInputWithInjections: number, affinity: PositionAffinity = PositionAffinity.None): OutputPosition {
		let low = 0;
		let high = this.breakOffsets.length - 1;
		let mid = 0;
		let midStart = 0;

		while (low <= high) {
			mid = low + ((high - low) / 2) | 0;

			const midStop = this.breakOffsets[mid];
			midStart = mid > 0 ? this.breakOffsets[mid - 1] : 0;

			if (affinity === PositionAffinity.Left) {
				if (offsetInInputWithInjections <= midStart) {
					high = mid - 1;
				} else if (offsetInInputWithInjections > midStop) {
					low = mid + 1;
				} else {
					break;
				}
			} else {
				if (offsetInInputWithInjections < midStart) {
					high = mid - 1;
				} else if (offsetInInputWithInjections >= midStop) {
					low = mid + 1;
				} else {
					break;
				}
			}
		}

		let outputOffset = offsetInInputWithInjections - midStart;
		if (mid > 0) {
			outputOffset += this.wrappedTextIndentLength;
		}

		return new OutputPosition(mid, outputOffset);
	}

	public normalizeOutputPosition(outputLineIndex: number, outputOffset: number, affinity: PositionAffinity): OutputPosition {
		if (this.injectionOffsets !== null) {
			const offsetInInputWithInjections = this.outputPositionToOffsetInInputWithInjections(outputLineIndex, outputOffset);
			const normalizedOffsetInUnwrappedLine = this.normalizeOffsetInInputWithInjectionsAroundInjections(offsetInInputWithInjections, affinity);
			if (normalizedOffsetInUnwrappedLine !== offsetInInputWithInjections) {
				// injected text caused a change
				return this.offsetInInputWithInjectionsToOutputPosition(normalizedOffsetInUnwrappedLine, affinity);
			}
		}

		if (affinity === PositionAffinity.Left) {
			if (outputLineIndex > 0 && outputOffset === this.getMinOutputOffset(outputLineIndex)) {
				return new OutputPosition(outputLineIndex - 1, this.getMaxOutputOffset(outputLineIndex - 1));
			}
		}
		else if (affinity === PositionAffinity.Right) {
			const maxOutputLineIndex = this.getOutputLineCount() - 1;
			if (outputLineIndex < maxOutputLineIndex && outputOffset === this.getMaxOutputOffset(outputLineIndex)) {
				return new OutputPosition(outputLineIndex + 1, this.getMinOutputOffset(outputLineIndex + 1));
			}
		}

		return new OutputPosition(outputLineIndex, outputOffset);
	}

	private outputPositionToOffsetInInputWithInjections(outputLineIndex: number, outputOffset: number): number {
		if (outputLineIndex > 0) {
			outputOffset = Math.max(0, outputOffset - this.wrappedTextIndentLength);
		}
		const result = (outputLineIndex > 0 ? this.breakOffsets[outputLineIndex - 1] : 0) + outputOffset;
		return result;
	}

	private normalizeOffsetInInputWithInjectionsAroundInjections(offsetInInputWithInjections: number, affinity: PositionAffinity): number {
		const injectedText = this.getInjectedTextAtOffset(offsetInInputWithInjections);
		if (!injectedText) {
			return offsetInInputWithInjections;
		}

		if (affinity === PositionAffinity.None) {
			if (offsetInInputWithInjections === injectedText.offsetInInputWithInjections + injectedText.length
				&& hasRightCursorStop(this.injectionOptions![injectedText.injectedTextIndex].cursorStops)) {
				return injectedText.offsetInInputWithInjections + injectedText.length;
			} else {
				let result = injectedText.offsetInInputWithInjections;
				if (hasLeftCursorStop(this.injectionOptions![injectedText.injectedTextIndex].cursorStops)) {
					return result;
				}

				let index = injectedText.injectedTextIndex - 1;
				while (index >= 0 && this.injectionOffsets![index] === this.injectionOffsets![injectedText.injectedTextIndex]) {
					if (hasRightCursorStop(this.injectionOptions![index].cursorStops)) {
						break;
					}
					result -= this.injectionOptions![index].content.length;
					if (hasLeftCursorStop(this.injectionOptions![index].cursorStops)) {
						break;
					}
					index--;
				}

				return result;
			}
		} else if (affinity === PositionAffinity.Right || affinity === PositionAffinity.RightOfInjectedText) {
			if (offsetInInputWithInjections === injectedText.offsetInInputWithInjections && this.standsForConcealedText(injectedText.injectedTextIndex)) {
				// The place in front of a replacement is the range start, not a side of the injected text.
				return offsetInInputWithInjections;
			}

			let result = injectedText.offsetInInputWithInjections + injectedText.length;
			let index = injectedText.injectedTextIndex;
			// traverse all injected text that touch each other
			while (index + 1 < this.injectionOffsets!.length && this.injectionOffsets![index + 1] === this.injectionOffsets![index]) {
				result += this.injectionOptions![index + 1].content.length;
				index++;
			}
			return result;
		} else if (affinity === PositionAffinity.Left || affinity === PositionAffinity.LeftOfInjectedText) {
			if (offsetInInputWithInjections === injectedText.offsetInInputWithInjections + injectedText.length && this.standsForConcealedText(injectedText.injectedTextIndex)) {
				// Mirror: the place behind a replacement is the range end.
				return offsetInInputWithInjections;
			}

			// affinity is left
			let result = injectedText.offsetInInputWithInjections;
			let index = injectedText.injectedTextIndex;
			// traverse all injected text that touch each other
			while (index - 1 >= 0 && this.injectionOffsets![index - 1] === this.injectionOffsets![index]) {
				result -= this.injectionOptions![index - 1].content.length;
				index--;
			}
			return result;
		}

		assertNever(affinity);
	}

	public getInjectedText(outputLineIndex: number, outputOffset: number): InjectedText | null {
		const offset = this.outputPositionToOffsetInInputWithInjections(outputLineIndex, outputOffset);
		const injectedText = this.getInjectedTextAtOffset(offset);
		if (!injectedText) {
			return null;
		}
		return {
			options: this.injectionOptions![injectedText.injectedTextIndex]
		};
	}

	private getInjectedTextAtOffset(offsetInInputWithInjections: number): { injectedTextIndex: number; offsetInInputWithInjections: number; length: number } | undefined {
		const injectionOffsets = this.injectionOffsets;
		const injectionOptions = this.injectionOptions;

		if (injectionOffsets !== null) {
			let totalInjectedTextLengthBefore = 0;
			let totalConcealedTextLengthBefore = 0;
			let concealIndex = 0;
			for (let i = 0; i < injectionOffsets.length; i++) {
				// Concealed ranges before this injection shift it towards the start of the line.
				while (concealIndex < this._concealCount && this.concealOffsets![concealIndex] < injectionOffsets[i]) {
					totalConcealedTextLengthBefore += this.concealLengths![concealIndex];
					concealIndex++;
				}

				const length = injectionOptions![i].content.length;
				const injectedTextStartOffsetInInputWithInjections = injectionOffsets[i] + totalInjectedTextLengthBefore - totalConcealedTextLengthBefore;
				const injectedTextEndOffsetInInputWithInjections = injectedTextStartOffsetInInputWithInjections + length;

				if (injectedTextStartOffsetInInputWithInjections > offsetInInputWithInjections) {
					// Injected text starts later.
					break; // All later injected texts have an even larger offset.
				}

				if (offsetInInputWithInjections <= injectedTextEndOffsetInInputWithInjections) {
					// Injected text ends after or with the given position (but also starts with or before it).
					return {
						injectedTextIndex: i,
						offsetInInputWithInjections: injectedTextStartOffsetInInputWithInjections,
						length
					};
				}

				totalInjectedTextLengthBefore += length;
			}
		}

		return undefined;
	}
}

function hasRightCursorStop(cursorStop: InjectedTextCursorStops | null | undefined): boolean {
	if (cursorStop === null || cursorStop === undefined) { return true; }
	return cursorStop === InjectedTextCursorStops.Right || cursorStop === InjectedTextCursorStops.Both;
}
function hasLeftCursorStop(cursorStop: InjectedTextCursorStops | null | undefined): boolean {
	if (cursorStop === null || cursorStop === undefined) { return true; }
	return cursorStop === InjectedTextCursorStops.Left || cursorStop === InjectedTextCursorStops.Both;
}

export class InjectedText {
	constructor(public readonly options: InjectedTextOptions) { }
}

/**
 * The view's changes to a model line: its concealed ranges and its injected text.
 */
export interface IProjectedLineChanges {
	readonly injectionOffsets: number[] | null;
	readonly injectionOptions: InjectedTextOptions[] | null;
	readonly concealOffsets: number[] | null;
	readonly concealLengths: number[] | null;
	readonly concealStops: ConcealedTextCursorStop[] | null;
}

/**
 * Turns a line's concealed and injected text into the offsets a {@link ModelLineProjectionData}
 * is built from. Injected text strictly inside a concealed range is dropped; a replacement is
 * injected at its range start, after text already injected there.
 */
const graphemeSegmenter = new Lazy(() => new Intl.Segmenter(undefined, { granularity: 'grapheme' }));

/**
 * Rendered width in cells: full-width and emoji graphemes count two, a tab counts one.
 */
function textCellWidth(text: string): number {
	let cells = 0;
	for (const segment of graphemeSegmenter.value.segment(text)) {
		const codePoint = segment.segment.codePointAt(0)!;
		cells += (strings.isFullWidthCharacter(codePoint) || strings.isEmojiImprecise(codePoint)) ? 2 : 1;
	}
	return cells;
}

/**
 * Fits text to exactly `cells` rendered cells: padded with spaces when narrower, clipped at a
 * grapheme boundary and marked with a trailing `…` when wider.
 */
function fitToCellWidth(text: string, cells: number): string {
	const width = textCellWidth(text);
	if (width === cells) {
		return text;
	}
	if (width < cells) {
		return text + ' '.repeat(cells - width);
	}
	let taken = 0;
	let end = 0;
	for (const segment of graphemeSegmenter.value.segment(text)) {
		const codePoint = segment.segment.codePointAt(0)!;
		const graphemeCells = (strings.isFullWidthCharacter(codePoint) || strings.isEmojiImprecise(codePoint)) ? 2 : 1;
		if (taken + graphemeCells > cells - 1) {
			break;
		}
		taken += graphemeCells;
		end = segment.index + segment.segment.length;
	}
	const result = text.substring(0, end) + '…';
	return taken + 1 < cells ? result + ' '.repeat(cells - taken - 1) : result;
}

export function computeProjectedLineChanges(injectedTexts: LineInjectedText[] | null, concealedTexts: LineConcealedText[] | null, lineText: string = ''): IProjectedLineChanges {
	if (!concealedTexts || concealedTexts.length === 0) {
		if (!injectedTexts || injectedTexts.length === 0) {
			return { injectionOffsets: null, injectionOptions: null, concealOffsets: null, concealLengths: null, concealStops: null };
		}
		return {
			injectionOffsets: injectedTexts.map(t => t.column - 1),
			injectionOptions: injectedTexts.map(t => t.options),
			concealOffsets: null,
			concealLengths: null,
			concealStops: null
		};
	}

	const injectionOffsets: number[] = [];
	const injectionOptions: InjectedTextOptions[] = [];
	const concealStops: ConcealedTextCursorStop[] = [];
	const injections = injectedTexts ?? [];
	let injectionIndex = 0;

	for (const concealedText of concealedTexts) {
		const startOffset = concealedText.startColumn - 1;
		const endOffset = concealedText.endColumn - 1;

		while (injectionIndex < injections.length && injections[injectionIndex].column - 1 <= startOffset) {
			injectionOffsets.push(injections[injectionIndex].column - 1);
			injectionOptions.push(injections[injectionIndex].options);
			injectionIndex++;
		}

		while (injectionIndex < injections.length && injections[injectionIndex].column - 1 < endOffset) {
			injectionIndex++;
		}

		// The replacement is injected at the range start: the place before it is the start, the
		// place behind it the end.
		const replacement = concealedText.options.replacement;
		const hasReplacement = !!replacement && replacement.content.length > 0;
		if (hasReplacement) {
			injectionOffsets.push(startOffset);
			// Drawn at the concealed text's rendered width: padded when narrower, clipped when wider.
			injectionOptions.push(concealedText.options.preserveWidth
				? { ...replacement, content: fitToCellWidth(replacement.content, textCellWidth(lineText.substring(startOffset, endOffset))) }
				: replacement);
		}

		// A range with a replacement has a side per end; it carries `After` and the stop never fires.
		concealStops.push(hasReplacement ? ConcealedTextCursorStop.After : (concealedText.options.cursorStop ?? ConcealedTextCursorStop.Auto));
	}

	for (; injectionIndex < injections.length; injectionIndex++) {
		injectionOffsets.push(injections[injectionIndex].column - 1);
		injectionOptions.push(injections[injectionIndex].options);
	}

	return {
		injectionOffsets: injectionOffsets.length > 0 ? injectionOffsets : null,
		injectionOptions: injectionOptions.length > 0 ? injectionOptions : null,
		concealOffsets: concealedTexts.map(c => c.startColumn - 1),
		concealLengths: concealedTexts.map(c => c.length),
		concealStops
	};
}

/**
 * Applies to a line the changes the view makes to it: concealed ranges are taken out and
 * injected text is put in, in one left to right pass.
 */
export function applyProjectedLineChanges(lineText: string, changes: IProjectedLineChanges): string {
	const { injectionOffsets, injectionOptions, concealOffsets, concealLengths } = changes;
	if (concealOffsets === null) {
		if (injectionOffsets === null) {
			return lineText;
		}
		return LineInjectedText.applyInjectedText(lineText, injectionOffsets.map(
			(offset, idx) => new LineInjectedText(0, 0, offset + 1, injectionOptions![idx], 0)
		));
	}

	let result = '';
	let lastOffset = 0;
	let injectionIndex = 0;
	const injectionCount = injectionOffsets?.length ?? 0;

	for (let i = 0; i < concealOffsets.length; i++) {
		const startOffset = concealOffsets[i];

		while (injectionIndex < injectionCount && injectionOffsets![injectionIndex] <= startOffset) {
			result += lineText.substring(lastOffset, injectionOffsets![injectionIndex]);
			lastOffset = injectionOffsets![injectionIndex];
			result += injectionOptions![injectionIndex].content;
			injectionIndex++;
		}

		result += lineText.substring(lastOffset, startOffset);
		lastOffset = startOffset + concealLengths![i];
	}

	for (; injectionIndex < injectionCount; injectionIndex++) {
		result += lineText.substring(lastOffset, injectionOffsets![injectionIndex]);
		lastOffset = injectionOffsets![injectionIndex];
		result += injectionOptions![injectionIndex].content;
	}

	result += lineText.substring(lastOffset);
	return result;
}

export class OutputPosition {
	outputLineIndex: number;
	outputOffset: number;

	constructor(outputLineIndex: number, outputOffset: number) {
		this.outputLineIndex = outputLineIndex;
		this.outputOffset = outputOffset;
	}

	toString(): string {
		return `${this.outputLineIndex}:${this.outputOffset}`;
	}

	toPosition(baseLineNumber: number): Position {
		return new Position(baseLineNumber + this.outputLineIndex, this.outputOffset + 1);
	}
}

export interface ILineBreaksComputerContext {
	getLineContent(lineNumber: number): string;
	getLineInjectedText(lineNumber: number): LineInjectedText[] | null;
	getLineConcealedText(lineNumber: number): LineConcealedText[] | null;
}

export interface ILineBreaksComputerFactory {
	createLineBreaksComputer(context: ILineBreaksComputerContext, fontInfo: FontInfo, tabSize: number, wrappingColumn: number, wrappingIndent: WrappingIndent, wordBreak: 'normal' | 'keepAll', wrapOnEscapedLineFeeds: boolean): ILineBreaksComputer;
}

export interface ILineBreaksComputer {
	/**
	 * Pass in `previousLineBreakData` if the only difference is in breaking columns!!!
	 */
	addRequest(lineNumber: number, previousLineBreakData: ModelLineProjectionData | null): void;
	finalize(): (ModelLineProjectionData | null)[];
}
