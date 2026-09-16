/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestThemeService } from '../../../../platform/theme/test/common/testThemeService.js';
import { CoreNavigationCommands } from '../../../browser/coreCommands.js';
import { IEditorOptions } from '../../../common/config/editorOptions.js';
import { Range } from '../../../common/core/range.js';
import { Selection } from '../../../common/core/selection.js';
import { StringBuilder } from '../../../common/core/stringBuilder.js';
import { IModelDeltaDecoration } from '../../../common/model.js';
import { TextModel } from '../../../common/model/textModel.js';
import { LineDecoration } from '../../../common/viewLayout/lineDecorations.js';
import { RenderLineInput, renderViewLine } from '../../../common/viewLayout/viewLineRenderer.js';
import { MonospaceLineBreaksComputerFactory } from '../../../common/viewModel/monospaceLineBreaksComputer.js';
import { ViewModel } from '../../../common/viewModel/viewModelImpl.js';
import { TestLanguageConfigurationService } from '../../common/modes/testLanguageConfigurationService.js';
import { createModelServices, instantiateTextModel } from '../../common/testTextModel.js';
import { TestConfiguration } from '../config/testConfiguration.js';

// Enabled by VSCODE_PERF_CONCEALED_TEXT=true; VSCODE_PERF_CONCEALED_TEXT_LINES sets the file size.
// The no-conceal-code reference row comes from the same file run on the merge base with the
// `conceal` option and the concealing scenarios removed.
const enablePerf = typeof process !== 'undefined' && process.env.VSCODE_PERF_CONCEALED_TEXT === 'true';
const lineCount = (typeof process !== 'undefined' && Number(process.env.VSCODE_PERF_CONCEALED_TEXT_LINES)) || 20000;

function perfSuite(name: string, callback: (this: Mocha.Suite) => void): void {
	if (enablePerf) {
		suite(name, callback);
	}
}

const VIEWPORT_LINES = 50;
// Set VSCODE_PERF_CONCEALED_TEXT_PROFILE to a directory to write a V8 CPU profile of each measured pass's
// keystroke loop there, taken by the test runner's main process over IPC; the timings of such a run are
// not comparable to a plain one.
const profileDir = typeof process !== 'undefined' ? process.env.VSCODE_PERF_CONCEALED_TEXT_PROFILE : undefined;
const KEYSTROKES = profileDir ? 2000 : 200;

async function profileKeystrokes(tag: string | undefined, run: () => void): Promise<void> {
	const nodeRequire = (globalThis as { require?: (id: string) => unknown }).require;
	if (!profileDir || !tag || typeof nodeRequire !== 'function') {
		run();
		return;
	}
	const { ipcRenderer } = nodeRequire('electron') as { ipcRenderer: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } };
	await ipcRenderer.invoke('vscode:perfProfile', 'start');
	run();
	await ipcRenderer.invoke('vscode:perfProfile', 'stop', tag.replace(/[^\w.-]+/g, '-'));
}
const CARET_LINES = 50;
const WARMUP_PASSES = 2;
const MEASURED_PASSES = 5;

interface Scenario {
	readonly name: string;
	readonly conceal: boolean;
	readonly wrap: boolean;
	readonly decorations: 'none' | 'hidden ids' | 'glyphs' | 'injected glyphs' | 'css ids';
}

interface Result {
	readonly scenario: Scenario;
	readonly openMs: number;
	readonly decorateMs: number;
	readonly renderMs: number;
	readonly viewportCount: number;
	readonly typeMs: number;
	readonly caretMs: number;
}

const scenarios: Scenario[] = [
	{ name: 'conceal off', conceal: false, wrap: false, decorations: 'none' },
	{ name: 'conceal on, nothing concealed', conceal: true, wrap: false, decorations: 'none' },
	{ name: 'conceal on, hidden id per line', conceal: true, wrap: false, decorations: 'hidden ids' },
	{ name: 'conceal on, glyph per line', conceal: true, wrap: false, decorations: 'glyphs' },
	{ name: 'conceal on, injected glyph per line', conceal: true, wrap: false, decorations: 'injected glyphs' },
	{ name: 'conceal off, css-hidden id per line', conceal: false, wrap: false, decorations: 'css ids' },
	{ name: 'conceal on, css-hidden id per line', conceal: true, wrap: false, decorations: 'css ids' },
	{ name: 'wrap, conceal off', conceal: false, wrap: true, decorations: 'none' },
	{ name: 'wrap, conceal on, nothing concealed', conceal: true, wrap: true, decorations: 'none' },
	{ name: 'wrap, conceal on, hidden id per line', conceal: true, wrap: true, decorations: 'hidden ids' },
	{ name: 'wrap, conceal on, injected glyph per line', conceal: true, wrap: true, decorations: 'injected glyphs' },
	{ name: 'wrap, conceal on, glyph per line', conceal: true, wrap: true, decorations: 'glyphs' },
];

function fixtureLine(i: number): string {
	return `- item ${i} lorem ipsum dolor sit amet {ID:A1B2C3} consectetur adipiscing #todo elit sed do eiusmod`;
}

function decorationsFor(scenario: Scenario, lines: string[]): IModelDeltaDecoration[] {
	if (scenario.decorations === 'none') {
		return [];
	}
	const result: IModelDeltaDecoration[] = [];
	for (let i = 0; i < lines.length; i++) {
		const lineNumber = i + 1;
		const idStart = lines[i].indexOf('{ID:') + 1;
		const tagStart = lines[i].indexOf('#todo') + 1;
		switch (scenario.decorations) {
			case 'hidden ids':
				result.push({ range: new Range(lineNumber, idStart, lineNumber, idStart + 11), options: { description: 'perf', concealedText: {} } });
				break;
			case 'glyphs':
				result.push({ range: new Range(lineNumber, tagStart, lineNumber, tagStart + 5), options: { description: 'perf', concealedText: { replacement: { content: '☐' } } } });
				break;
			case 'injected glyphs':
				result.push({ range: new Range(lineNumber, tagStart, lineNumber, tagStart + 5), options: { description: 'perf', after: { content: '☐' } } });
				break;
			case 'css ids':
				result.push({ range: new Range(lineNumber, idStart, lineNumber, idStart + 11), options: { description: 'perf', inlineClassName: 'hidden-id' } });
				break;
		}
	}
	return result;
}

async function measure(scenario: Scenario, lines: string[], profileTag?: string): Promise<Result> {
	const disposables = new DisposableStore();
	const instantiationService = createModelServices(disposables);
	const options: IEditorOptions = {
		conceal: { enabled: scenario.conceal },
		wordWrap: scenario.wrap ? 'wordWrapColumn' : 'off',
		wordWrapColumn: 60,
	};
	const configuration = new TestConfiguration(options);
	const model: TextModel = instantiateTextModel(instantiationService, lines.join('\n'));
	const factory = MonospaceLineBreaksComputerFactory.create(configuration.options);
	const languageConfigurationService = new TestLanguageConfigurationService();

	const sw = StopWatch.create(true);
	const viewModel = new ViewModel(1, configuration, model, factory, factory, null!, languageConfigurationService, new TestThemeService(), {
		setVisibleLines() { },
	}, {
		batchChanges: (cb) => cb(),
	});
	const openMs = sw.elapsed();

	sw.reset();
	model.deltaDecorations([], decorationsFor(scenario, lines));
	const decorateMs = sw.elapsed();

	// Scroll through the whole file, one viewport at a time, building each line's HTML.
	const sb = new StringBuilder(10000);
	const viewLineCount = viewModel.getLineCount();
	let viewportCount = 0;
	sw.reset();
	for (let start = 1; start <= viewLineCount; start += VIEWPORT_LINES) {
		const end = Math.min(start + VIEWPORT_LINES - 1, viewLineCount);
		const visibleRange = new Range(start, 1, end, viewModel.getLineMaxColumn(end));
		for (let lineNumber = start; lineNumber <= end; lineNumber++) {
			const d = viewModel.getViewportViewLineRenderingData(visibleRange, lineNumber);
			sb.reset();
			renderViewLine(new RenderLineInput(
				true, true, d.content, d.continuesWithWrappedLine, d.isBasicASCII, d.containsRTL, 0, d.tokens,
				LineDecoration.filter(d.inlineDecorations, lineNumber, d.minColumn, d.maxColumn),
				d.tabSize, d.startVisibleColumn, 7, 7, 7, 10000, 'none', false, false, null, d.textDirection, 14
			), sb);
		}
		viewportCount++;
	}
	const renderMs = sw.elapsed();

	// A keystroke in visible text just past the id, on lines spread over the file.
	const step = Math.max(1, Math.floor(lines.length / KEYSTROKES));
	sw.reset();
	await profileKeystrokes(profileTag, () => {
		for (let i = 0; i < KEYSTROKES; i++) {
			const lineNumber = 1 + i * step;
			const column = lines[lineNumber - 1].indexOf('{ID:') + 14;
			viewModel.setSelections('test', [new Selection(lineNumber, column, lineNumber, column)]);
			viewModel.type('x', 'keyboard');
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(viewModel.getPosition());
			viewModel.getViewLineRenderingData(viewPosition.lineNumber);
		}
	});
	const typeMs = sw.elapsed() / KEYSTROKES;

	// The caret walks a whole line, crossing the concealed range.
	let moves = 0;
	sw.reset();
	for (let i = 0; i < CARET_LINES; i++) {
		const lineNumber = 1 + i * step;
		viewModel.setSelections('test', [new Selection(lineNumber, 1, lineNumber, 1)]);
		const columns = model.getLineMaxColumn(lineNumber);
		for (let c = 1; c < columns; c++) {
			CoreNavigationCommands.CursorRight.runCoreEditorCommand(viewModel, {});
			moves++;
		}
	}
	const caretMs = sw.elapsed() / moves;

	viewModel.dispose();
	model.dispose();
	configuration.dispose();
	languageConfigurationService.dispose();
	disposables.dispose();

	return { scenario, openMs, decorateMs, renderMs, viewportCount, typeMs, caretMs };
}

function median(runs: Result[]): Result {
	const pick = (get: (r: Result) => number) => {
		const values = runs.map(get).sort((a, b) => a - b);
		return values[Math.floor(values.length / 2)];
	};
	return {
		scenario: runs[0].scenario,
		viewportCount: runs[0].viewportCount,
		openMs: pick(r => r.openMs),
		decorateMs: pick(r => r.decorateMs),
		renderMs: pick(r => r.renderMs),
		typeMs: pick(r => r.typeMs),
		caretMs: pick(r => r.caretMs),
	};
}

perfSuite('Performance - concealed text', function () {

	ensureNoDisposablesAreLeakedInTestSuite();

	const lines: string[] = [];
	for (let i = 1; i <= lineCount; i++) {
		lines.push(fixtureLine(i));
	}
	const results: Result[] = [];

	for (const scenario of scenarios) {
		test(scenario.name, async () => {
			const runs: Result[] = [];
			for (let pass = 0; pass < WARMUP_PASSES + MEASURED_PASSES; pass++) {
				const run = await measure(scenario, lines, pass >= WARMUP_PASSES ? `${scenario.name}.pass${pass - WARMUP_PASSES + 1}` : undefined);
				if (pass >= WARMUP_PASSES) {
					runs.push(run);
				}
			}
			results.push(median(runs));
		});
	}

	// Printed outside a test: the runner flags console output inside one as a failure.
	suiteTeardown(() => {
		const ms = (n: number, digits = 0) => n.toFixed(digits).padStart(8);
		console.log(`\n${lineCount} lines, viewport ${VIEWPORT_LINES} lines, median of ${MEASURED_PASSES} passes`);
		console.log(`${'scenario'.padEnd(40)}${'open'.padStart(8)}${'decorate'.padStart(9)}${'render'.padStart(8)}${'/vport'.padStart(8)}${'/key'.padStart(8)}${'/move'.padStart(8)}   (ms)`);
		for (const r of results) {
			console.log(`${r.scenario.name.padEnd(40)}${ms(r.openMs)}${ms(r.decorateMs).padStart(9)}${ms(r.renderMs)}${ms(r.renderMs / r.viewportCount, 2)}${ms(r.typeMs, 3)}${ms(r.caretMs, 3)}`);
		}
	});
});
