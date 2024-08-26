// This is a script to download all the versions of a websim.ai site to bring it into local version control.

// First, copy and paste this script into the browser console to collect versions,
// then paste the result into the script as the versions array below, and run the script in Node.js to download the versions.

// Optionally, before running the script in Node.js, you can edit the commit summaries (and add notes) in the versions array.
// You can add commit summaries with an LLM (like ChatGPT) with a prompt like "Add short one-line commitSummary fields to these, based on the prompts."
// or use GitHub Copilot to autocomplete the commit summaries interactively, or just enter them manually.
// One could also edit commit messages later running the script, possibly in one big `rebase -i`.
// Recommended: if using a chatbot-style LLM interface, run a diff between the original input and the output to check for unexpected changes.
// It may incidentally try to fix typos in your prompts, for instance, or simply mess up the JSON syntax.
// An autocompletion-style LLM interface (like GitHub Copilot) would avoid this issue.
// Also: note that the LLM doesn't know what changes where successfully made by the other LLM (powering websim).
// summaries like "Fix <some issue>" may be more accurately written as "Try to fix <some issue>" :)

// ------------------------------

// WebSim is using unsemantic HTML, with only presentational classes, unfortunately,
// so I can't just find the list of versions with a selector like `ul.versions`.
// Instead I'm prompting the user to select the element with the list of versions.

// By the way, the nodes in this (non-semantic) list are presented in the reverse order from how they are in the DOM, as of 2024-07-27.
// The first node is the earliest version, shown at the bottom of the list.

// (Hm, I guess I could select based on the class .flex-col-reverse, since if that's removed the script is likely to break anyway...
// and then also check that the selected element contains version links - filter based on this, and then assert that there's only one element matching the filter.
// That would take care of the first interaction... as for finding a selector for the prompt text, that seems trickier,
// but maybe I could get the prompt from the "address bar" and the find an element in the list (deepest in the DOM) that contains that text.)

// TODO: Make automation easier to cancel. To hit Esc after pasting the script in the console, you have to focus the page,
// but clicking will select an element, so you have to press the mouse button down and then hit Esc before releasing it.
// Also there's no way to abort once it starts collecting versions, so it should be possible to cancel that too.
// Could add a cancel button. Could add a start button too, so the page is likely focused when you try to press Esc.
// Could also move the overlay to the bottom of the screen since the version list is near the top.

async function collectAllVersions(versionListDivSelector, promptSelector) {
	const aggregatedResults = [];

	function collectVisibleVersions() {
		// Don't move this querySelector outside the function; apparently the whole browser UI is recreated when clicking the link
		const versionListDivElement = document.querySelector(versionListDivSelector);
		if (!versionListDivElement) {
			return [];
		}
		const linkUrls = [...versionListDivElement.querySelectorAll(`a[href^='https://websim.ai/c/']`)].map(a => a.href);
		const prompts = [...versionListDivElement.querySelectorAll(promptSelector)].map((el) => el.textContent);
		const associated = prompts.map((prompt, i) => {
			const id = linkUrls[i].match(/https:\/\/websim.ai\/c\/([^/]+)/)[1];
			return { prompt, id };
		});
		return associated;
	}

	function waitFor(condition, { timeout = 10000, interval = 100 } = {}) {
		return new Promise((resolve, reject) => {
			const timer = setInterval(() => {
				if (condition()) {
					clearInterval(timer);
					resolve();
				}
			}, interval);
			setTimeout(() => {
				clearInterval(timer);
				reject("Timed out waiting for condition.");
			}, timeout);
		});
	}

	function waitForVersionListToChange(oldVisibleVersions) {
		return waitFor(() => {
			const visibleVersions = collectVisibleVersions();
			console.log("Waiting for version list to change, old:", oldVisibleVersions, "new:", visibleVersions);
			if (visibleVersions.length === 0) {
				openVersionList();
				return false;
			}
			// return visibleVersions[0].id !== oldVisibleVersions[0].id;
			// In the case that we're moving to the view that has just the earliest item,
			// the earliest item will be the same as in the last snapshot,
			// so we need to check the latest items instead.
			return visibleVersions[visibleVersions.length - 1].id !== oldVisibleVersions[oldVisibleVersions.length - 1].id;
		}).then(() => {
			// Wait for the version list to stabilize (finish loading)
			let baseline = collectVisibleVersions();
			return waitFor(() => {
				const visibleVersions = collectVisibleVersions();
				console.log("Waiting for version list to stabilize (finish loading), loaded already:", baseline.length, "loaded now:", visibleVersions.length);
				const finishedLoading = visibleVersions.length === baseline.length;
				baseline = visibleVersions; // must be updated after comparison
				return finishedLoading;
			}, { interval: 2000 });
		});
	}

	async function collectAndClickEarliest() {
		const visibleVersions = collectVisibleVersions();
		if (aggregatedResults.length > 0) {
			// Sanity check: each capture should overlap by one version
			const earliestRecordedVersion = aggregatedResults[0];
			const latestVisibleVersion = visibleVersions[visibleVersions.length - 1];
			if (earliestRecordedVersion.id !== latestVisibleVersion.id) {
				alert("Warning: The first node in the visible list is not the same as the last node in the previous capture. The order of versions may be incorrect.");
			}
			// There should be no other duplicates
			const duplicate = visibleVersions.slice(0, -1).find(({ id }) => aggregatedResults.some((item) => item.id === id));
			if (duplicate) {
				alert("Warning: Duplicate versions found in the visible list compared to the previous capture.");
			}
			// Add all but the last version, which is already in the previous capture
			aggregatedResults.unshift(...visibleVersions.slice(0, -1));
		} else {
			aggregatedResults.unshift(...visibleVersions);
		}

		if (visibleVersions.length === 0) {
			alert("Websim version links not found.");
			return;
		}
		if (visibleVersions.length === 1) {
			// Done - No more versions to collect.
			return;
		}

		// In parallel, wait for the version list to change and click the earliest version link
		let versionListDivElement = document.querySelector(versionListDivSelector);
		const earliestVersionLink = versionListDivElement.querySelector(`a[href^='https://websim.ai/c/']`);
		await Promise.all([
			waitForVersionListToChange(visibleVersions).catch((err) => {
				alert("Timed out waiting for the version list to change.");
			}),
			new Promise((resolve) => {
				earliestVersionLink.click();
				resolve();
			}),
		]);

		await collectAndClickEarliest();
	}

	await collectAndClickEarliest();

	return aggregatedResults;
}

function handleContinuePrompts(websimVersions) {
	const versionsForGit = [];
	let currentVersion = null;
	for (const { prompt, id, commitNote } of websimVersions) {
		if (prompt === "!continue" && currentVersion) {
			currentVersion.id = id;
			const noteAboutContinue = "Note: used !continue to complete the output.";
			currentVersion.commitNote = currentVersion.commitNote
				? (
					currentVersion.commitNote.startsWith(noteAboutContinue) ?
						currentVersion.commitNote
						: `${noteAboutContinue}\n${currentVersion.commitNote}`
				)
				: noteAboutContinue;
		} else {
			currentVersion = { prompt, id, commitNote };
			versionsForGit.push(currentVersion);
		}
	}
	return versionsForGit;
}

// Test cases
function runTests() {
	// Test 1: Basic functionality
	let input = [
		{ prompt: "First prompt", id: 1 },
		{ prompt: "!continue", id: 2 },
		{ prompt: "Second prompt", id: 3 }
	];
	let expectedOutput = [
		{ prompt: "First prompt", id: 2, commitNote: "Note: used !continue to complete the output." },
		{ prompt: "Second prompt", id: 3 }
	];
	let output = handleContinuePrompts(input);
	console.assert(JSON.stringify(output) === JSON.stringify(expectedOutput), "Test 1 Failed");

	// Test 2: No !continue prompts
	input = [
		{ prompt: "First prompt", id: 1 },
		{ prompt: "Second prompt", id: 2 }
	];
	expectedOutput = [
		{ prompt: "First prompt", id: 1 },
		{ prompt: "Second prompt", id: 2 }
	];
	output = handleContinuePrompts(input);
	console.assert(JSON.stringify(output) === JSON.stringify(expectedOutput), "Test 2 Failed");

	// Test 3: Multiple !continue prompts in a row
	input = [
		{ prompt: "First prompt", id: 1 },
		{ prompt: "!continue", id: 2 },
		{ prompt: "!continue", id: 3 },
		{ prompt: "Second prompt", id: 4 }
	];
	expectedOutput = [
		{ prompt: "First prompt", id: 3, commitNote: "Note: used !continue to complete the output." },
		{ prompt: "Second prompt", id: 4 }
	];
	output = handleContinuePrompts(input);
	console.assert(JSON.stringify(output) === JSON.stringify(expectedOutput), "Test 3 Failed");

	// Test 4: !continue at the start
	// If the list of versions is incomplete, but you want to download from it anyway,
	// it should include the first prompt, even if it's a !continue prompt.
	input = [
		{ prompt: "!continue", id: 1 },
		{ prompt: "First prompt", id: 2 }
	];
	expectedOutput = [
		{ prompt: "!continue", id: 1 },
		{ prompt: "First prompt", id: 2 }
	];
	output = handleContinuePrompts(input);
	console.assert(JSON.stringify(output) === JSON.stringify(expectedOutput), "Test 4 Failed");

	// Test 5: Preserving commit notes
	input = [
		{ prompt: "First prompt", id: 1, commitNote: "Note 1" },
		{ prompt: "!continue", id: 2, commitNote: "Note 2" },
		{ prompt: "Second prompt", id: 3, commitNote: "Note 3" }
	];
	expectedOutput = [
		{ prompt: "First prompt", id: 2, commitNote: "Note: used !continue to complete the output.\nNote 1" },
		{ prompt: "Second prompt", id: 3, commitNote: "Note 3" }
	];
	output = handleContinuePrompts(input);
	console.assert(JSON.stringify(output) === JSON.stringify(expectedOutput), "Test 5 Failed");
}

runTests();

function openVersionList() {
	// mouseup is what actually does it, but don't tell anyone
	const addressBar = document.querySelector("[name='url']");
	addressBar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	addressBar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
	addressBar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
	addressBar.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
	addressBar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}


// Based on https://jsfiddle.net/Sillvva/qof6h0up/
// found via https://stackoverflow.com/questions/8588301/how-to-generate-unique-css-selector-for-dom-element#comment115592481_49663134
function buildQuerySelector(elem, relativeToParent = document.body) {
	let path = [];
	let parent;
	while (parent = elem.parentNode) {
		let tag = elem.tagName;
		let siblings;
		// Avoiding invalid CSS selectors from certain class names like "max-h-[calc(100vh-8rem)]"
		// Could use escaping but this is simpler, and these layout framework classes are unlikely to be useful in selectors
		// Also "body.__classname_36bd41" is valid as a selector, but not useful, not sure where it comes from
		let classes = Array.from(elem.classList.values()).filter(c => /^[a-z][a-z0-9_\-]*$/i.test(c));
		let classStr = classes.length ? `.${classes.join('.')}` : '';
		path.unshift(
			elem.id ? `#${elem.id}` : (
				siblings = parent.children,
				[].filter.call(siblings, sibling =>
					sibling.tagName === tag &&
					JSON.stringify(classes.sort()) === JSON.stringify(
						Array.from(sibling.classList.values()).sort()
					)
				).length === 1 ?
					`${tag}${classStr}` :
					`${tag}${classStr}:nth-child(${1 + [].indexOf.call(siblings, elem)})`
			)
		);
		if (elem === relativeToParent) break;
		elem = parent;
	};
	return `${path.join(' > ')}`.toLowerCase();
};


// Add commit summaries (can be improved with ChatGPT or manual editing before committing)
function addCommitSummaries(results, placeholder) {
	return results.map(({ prompt, id }) => {
		let commitSummary = prompt;
		if (placeholder !== undefined) {
			commitSummary = placeholder;
		} else {
			const maxLength = 50;
			if (prompt.length > maxLength) {
				let cutOff = maxLength - '...'.length;
				if (prompt.includes("\n")) {
					cutOff = Math.min(cutOff, prompt.indexOf("\n"));
				}
				commitSummary = prompt.substring(0, cutOff) + '...';
			}
		}
		return { prompt, id, commitSummary };
	});
}

/**
 * Prompts the user to pick an element matching a selector.
 * @param {string | (Element => boolean)} elementFilter A CSS selector or a function that returns `true` for the desired elements.
 * @param {string} [message] The message to display to the user.
 * @param {string} [subMessage] Extra text to show below the main message.
 * @returns {Promise<Element | null>} The selected element, or `null` if no element was selected. May never resolve if the user cancels.
 */
async function pickElement(elementFilter, message = "Select an element.", subMessage = "") {
	const overlayMessage = document.createElement('div');
	overlayMessage.textContent = message;
	Object.assign(overlayMessage.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '100%',
		textAlign: 'center',
		fontSize: '2em',
		color: 'white',
		backgroundColor: 'rgba(0,0,0,0.5)',
		padding: '1em',
		pointerEvents: 'none',
		zIndex: '9999999999'
	});

	const smallText = document.createElement('small');
	smallText.style.display = 'block';
	smallText.style.fontSize = '0.6em';
	smallText.innerHTML = 'Press <kbd>Esc</kbd> to cancel.';
	if (subMessage) {
		smallText.prepend(subMessage, document.createElement('br'));
	}
	overlayMessage.appendChild(smallText);

	const targetOverlay = document.createElement('div');
	targetOverlay.classList.add('target-overlay');
	Object.assign(targetOverlay.style, {
		position: 'fixed',
		boxSizing: 'border-box',
		outline: '2px dashed black',
		boxShadow: '0 0 0 2px white, 0 0 0 3px red, 0 0 0 1px red inset',
		zIndex: '9999999999',
		cursor: 'pointer',
		display: 'none'
	});
	document.body.appendChild(targetOverlay);

	/** @type {Element | null} */
	let currentEl = null;

	const cleanup = () => {
		document.body.removeChild(overlayMessage);
		document.body.removeChild(targetOverlay);
		removeEventListener('keydown', keydown, true);
		removeEventListener('pointermove', pointermove, true);
		removeEventListener('pointerdown', pointerdown, true);
	};

	const promise = new Promise((resolve) => {
		targetOverlay.addEventListener('click', () => {
			cleanup();
			resolve(currentEl);
		});
	});

	const keydown = (/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Escape') {
			cleanup();
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	};

	const pointermove = (/** @type {PointerEvent} */ e) => {
		const matchedEl = document.elementsFromPoint(e.clientX, e.clientY)
			.find((el) =>
				(!el.matches('.target-overlay')) &&
				(typeof elementFilter === 'function' ? elementFilter(el) : el.matches(elementFilter)
				));
		if (matchedEl) {
			currentEl = matchedEl;
			const rect = matchedEl.getBoundingClientRect();
			Object.assign(targetOverlay.style, {
				top: `${rect.top}px`,
				left: `${rect.left}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
				display: 'block'
			});
		} else {
			targetOverlay.style.display = 'none';
		}
	};

	const pointerdown = (/** @type {PointerEvent} */ e) => {
		e.preventDefault(); // prevent focus change
	};

	addEventListener('keydown', keydown, true);
	addEventListener('pointermove', pointermove, true);
	addEventListener('pointerdown', pointerdown, true);

	document.body.appendChild(overlayMessage);

	return promise;
}

async function collectVersionsInteractively() {
	openVersionList();
	const hasLinks = (el) => el.querySelectorAll(`a[href^='https://websim.ai/c/']`).length > 0;
	const versionListDivElement = await pickElement(hasLinks, "Select the element containing the list of versions.", "(Click in the space between two items.)");
	const versionListDivSelector = buildQuerySelector(versionListDivElement);
	console.log("Generated version list selector:", versionListDivSelector);
	// Sanity check: the selector should match exactly the one element we picked
	if (document.querySelectorAll(versionListDivSelector).length !== 1) {
		alert("Error: The generated version list selector does not match exactly one element.");
		return;
	}
	if (document.querySelector(versionListDivSelector) !== versionListDivElement) {
		alert("Error: The generated version list selector matched a different element from the one picked.");
		return;
	}
	const mightBePrompt = (el) => el.textContent.length > 8 && el.closest(versionListDivSelector) === versionListDivElement && !hasLinks(el);
	const promptElement = await pickElement(mightBePrompt, "Select the prompt text from of the versions in the list.", "(Click directly on the text of a prompt.)");
	let promptSelector = buildQuerySelector(promptElement, versionListDivElement);
	console.log("Initially generated prompt selector:", promptSelector);
	// remove first :nth-child(), so that it matches multiple items, not the specific list item
	promptSelector = promptSelector.replace(/:nth-child\(\d+\)/, '');
	console.log("Adjusted generated prompt selector:", promptSelector);
	// Sanity check: the selector should match the element we picked (among others)
	if (document.querySelectorAll(promptSelector).length === 0) {
		alert("Error: The generated prompt selector does not match any elements.");
		return;
	}
	if (!promptElement.matches(promptSelector)) {
		alert("Error: The picked prompt element does not match the generated selector.");
		return;
	}
	const allVersions = handleContinuePrompts(await collectAllVersions(versionListDivSelector, promptSelector));
	const versionsWithTruncatedPromptCommitSummaries = addCommitSummaries(allVersions);
	const versionsWithGenericCommitSummaries = addCommitSummaries(allVersions, "WebSim updates");
	const versionsWithEmptyCommitSummaries = addCommitSummaries(allVersions, "");
	const jsonWithTruncatedPromptCommitSummaries = JSON.stringify(versionsWithTruncatedPromptCommitSummaries, null, "\t");
	const jsonWithGenericCommitSummaries = JSON.stringify(versionsWithGenericCommitSummaries, null, "\t");
	const llmPrompt = `${JSON.stringify(versionsWithEmptyCommitSummaries, null, "\t")}\n\n\nAdd short one-line commitSummary fields to these, based on the prompts.`;
	console.log(jsonWithTruncatedPromptCommitSummaries);
	showOutputDialog([
		{ outputText: jsonWithTruncatedPromptCommitSummaries, noun: "JSON", label: "JSON with truncated prompt commit summaries", default: true },
		{ outputText: jsonWithGenericCommitSummaries, noun: "JSON", label: "JSON with generic commit summaries", default: true },
		{ outputText: llmPrompt, noun: "LLM prompt", label: "LLM prompt for better automatic commit summaries" },
	]);
}

function showOutputDialog(options) {
	// Remove existing stylesheet if it exists
	const existingStyle = document.getElementById('websim-exporter-dialog-style');
	if (existingStyle) {
		existingStyle.remove();
	}

	// Create a new stylesheet
	const style = document.createElement('style');
	style.id = 'websim-exporter-dialog-style';
	style.textContent = `
		.websim-exporter-dialog {
			font-family: Arial, sans-serif;
			background-color: #f9f9f9;
			border: 1px solid #ccc;
			padding: 20px;
			position: fixed;
			box-shadow: 0 4px 8px rgba(0,0,0,0.1);
			border-radius: 4px;
			z-index: 1000;
			display: flex;
			flex-direction: column;
			align-items: center;
		}
		.websim-exporter-dialog label {
			margin-bottom: 10px;
		}
		.websim-exporter-dialog .output-preview {
			border: 1px solid #ccc;
			padding: 10px;
			width: 70vw;
			height: 70vh;
			white-space: pre-wrap;
			overflow-wrap: break-word;
			overflow-y: auto;
			margin-bottom: 20px;
		}
		.websim-exporter-dialog .buttons {
			margin-top: 10px;
		}
		.websim-exporter-dialog .buttons button {
			margin: 0 5px;
			padding: 8px 16px;
			cursor: pointer;
			border: none;
			background-color: #007bff;
			color: white;
			border-radius: 4px;
			outline: none;
		}
		.websim-exporter-dialog .buttons button:hover {
			background-color: #0056b3;
		}
		.websim-exporter-toast {
			position: fixed;
			bottom: 30px;
			right: 30px;
			background-color: rgba(0, 0, 0, 0.8);
			color: white;
			padding: 10px 20px;
			border-radius: 4px;
			z-index: 1100;
		}
		.websim-exporter-toast.error {
			background-color: #dc3545;
		}
		.websim-exporter-toast.success {
			background-color: #28a745;
		}
	`;

	document.head.appendChild(style);

	// Create dialog element
	const dialog = document.createElement('dialog');
	dialog.classList.add('websim-exporter-dialog');

	// Create radio group and output preview
	const radioGroup = document.createElement('div');
	options.forEach((opt, index) => {
		const radioInput = document.createElement('input');
		radioInput.type = 'radio';
		radioInput.id = `option${index}`;
		radioInput.name = 'outputOption';
		radioInput.value = index.toString();
		radioInput.addEventListener('change', () => {
			previewOutput(opt.outputText, opt.noun);
		});
		if (opt.default) {
			radioInput.checked = true;
			// previewOutput(opt.outputText, opt.noun); called after outputPreview is created
			// could reorder things to simplify this a bit
		}

		const radioLabel = document.createElement('label');
		radioLabel.setAttribute('for', `option${index}`);
		radioLabel.textContent = opt.label;

		radioGroup.appendChild(radioInput);
		radioGroup.appendChild(radioLabel);
		radioGroup.appendChild(document.createElement('br'));
	});

	const outputPreview = document.createElement('pre');
	outputPreview.classList.add('output-preview');

	dialog.appendChild(radioGroup);
	dialog.appendChild(outputPreview);

	// Create close button
	const closeButton = document.createElement('button');
	closeButton.textContent = 'Close';
	closeButton.addEventListener('click', () => {
		dialog.remove();
	});

	// Create copy to clipboard button
	const copyButton = document.createElement('button');
	copyButton.textContent = 'Copy to Clipboard';
	copyButton.addEventListener('click', () => {
		const selectedOption = document.querySelector('input[name="outputOption"]:checked');
		if (selectedOption) {
			const index = parseInt(selectedOption.value);
			const selectedOpt = options[index];

			// Copy to clipboard logic
			navigator.clipboard.writeText(selectedOpt.outputText)
				.then(() => {
					showToast(`Copied ${selectedOpt.noun} to clipboard.`, 'success');
				})
				.catch((err) => {
					showToast(`Failed to copy ${selectedOpt.noun} to clipboard: ${err}`, 'error');
				});
		}
	});

	const buttonContainer = document.createElement('div');
	buttonContainer.classList.add('buttons');
	buttonContainer.appendChild(closeButton);
	buttonContainer.appendChild(copyButton);
	dialog.appendChild(buttonContainer);

	// Handle default selection preview
	options.forEach((opt, index) => {
		if (opt.default) {
			previewOutput(opt.outputText, opt.noun);
		}
	});

	// Show dialog
	document.body.appendChild(dialog);
	dialog.showModal();

	// Function to preview selected output text
	function previewOutput(outputText, noun) {
		outputPreview.textContent = outputText;
	}

	// Function to show toast message
	function showToast(message, extraClass = '') {
		const toast = document.createElement('div');
		toast.classList.add('websim-exporter-toast', extraClass);
		toast.textContent = message;
		// document.body.appendChild(toast); // would go behind modal dialog
		dialog.append(toast);

		// Remove toast after 3 seconds
		setTimeout(() => {
			toast.remove();
		}, 3000);
	}
}

const versions = [
	{
		"prompt": "Sushi simulator with sticky rice particle physics and nori sheets",
		"id": "aYS0oemyQkAhdvfdy",
		"commitSummary": "Initial websim sushi simulator (2D)",
	},
	{
		"prompt": "3d sushi simulator",
		"id": "PBibS6LguLdjvyogC",
		"commitSummary": "Implement 3D sushi simulator",
	},
	{
		"prompt": "clicked: ```<button id=\"add-rice\" w-tid=\"10\" class=\"\">Add Rice</button>```",
		"id": "aOuSM8GZU8lt56hjV",
		"commitSummary": "Add some rice at start, and tweak rice color",
		"commitNote": `Note: I wasn't sure how I triggered this, but apparently
this is what the Delve option in WebSim's context menu does.`,
	},
	{
		"prompt": "The seaweed needs to be flexible",
		"id": "saMr81ojFUtVtd2dP",
		"commitSummary": "Make seaweed flexible",
	},
	{
		"prompt": "Add a toolbar with tools for camera and interaction",
		"id": "cCBDq7xtM3iTJdqNZ",
		"commitSummary": "Add toolbar with camera and interaction tools",
	},
	{
		"prompt": "- Remove \"roll sushi\" which doesn't do what it says.\n- Remove object count limits.\n- Style the UI consistently. I like the toolbar styles.",
		"id": "X3CDscjpnC0dVjGSJ",
		"commitSummary": "Remove 'roll sushi' and object limits; style UI (WARNING: infinite rice)",
		"commitNote": `Note: I didn't mean to remove the limit of rice added initially,
but technically, that is an "object count limit". Sigh.`,
	},
	{
		"prompt": "Only add 100 grains of rice at a time.\nMake rice stick together.",
		"id": "5oNpolAWpNUEU9mQg",
		"commitSummary": "Don't indefinitely add rice; try to make rice sticky",
		"commitNote": `Note: The AI decided to try to clump rice together when spawning a grain...
not when they collide.`,
	},
	{
		"prompt": "- Remove \"100 grains\" text\n- Add cursors during interaction\n- Fix object interaction (nothing is happening)\n- Fix panning/zooming tools (reconfigure touch and mouse mappings instead of disabling features; and MMB should always rotate regardless of tool selected)",
		"id": "ZjKuJAH9Tu92wCGaI",
		"commitSummary": "Update UI, try to fix interactions and camera controls",
	},
	{
		"prompt": "- LMB should not rotate the camera with interact/delete tools selected\n- Interact and delete tools still aren't working",
		"id": "olbZfQJusJud5OBFA",
		"commitSummary": "Try to fix tool interactions",
	},
	{
		"prompt": "- Add debug visualization for the interaction tools\n- Make the ground tan like wood\n- Make the ground plane very very large (effectively infinite but not infinity)",
		"id": "8VTA3fKlj94vGFAfx",
		"commitSummary": "Add debug viz; make ground infinite and tan",
	},
	{
		"prompt": "- Prevent raycasting to the debug visualization\n- Highlight the object under the cursor with emissive color for debugging",
		"id": "jt38cuNdDrP4wMqvu",
		"commitSummary": "Prevent raycasting to debug viz mesh; highlight objects",
	},
	{
		"prompt": "- Visualize the drag plane\n- Use a shared function for updating the mouse and raycasting, to eliminate a possible source of errors",
		"id": "wuKgn3S392eOeeMHP",
		"commitSummary": "Visualize drag plane*; unify mouse update function",
		"commitNote": "Note: *The drag plane is visualized incorrectly, oriented perpendicular.",
	},
	{
		"prompt": "Use pointer events",
		"id": "0volgxS2KXTah1cSX",
		"commitSummary": "Switch to pointer events, fixing tool interaction",
		"commitNote": `Note: This fixes tool interaction as well as starting to add touch support.
I didn't determine exactly why it wasn't working, but the mouse handler wasn't called.
I guessed that it could be some other mouse event handler interfering,
and I thought of pointer events as a possible workaround, and it indeed worked.`,
	},
	{
		"prompt": "- Prevent raycasting to the drag plane mesh\n- Fix the drag plane orientation",
		"id": "gZVzrw53ZxxU6n0dO",
		"commitSummary": "Prevent raycasting to drag plane viz, and try to fix its orientation*",
		"commitNote": `Note: *The drag plane is still not oriented correctly,
and it's much more dubious now, how it's orienting it.`,
	},
	{
		"prompt": "Disable debug visualization by default, but make it an option",
		"id": "vxZmguF3Hs3UbW9GB",
		"commitSummary": "Make debug viz optional and disabled by default",
	},
	{
		"prompt": "- Do drag interaction during animation loop, not just on mouse move, so it doesn't fall when not moving the mouse.\n- Use standard checkbox control order (move to left of label).\n- Use default, grab, and grabbing cursors depending on the state of the interact tool.\n- Use default cursor for rotate tool.\n- Make the interact tool the default tool.\n- Add a bamboo mat object similar to how the seaweed currently works.",
		"id": "R7QfbnWlFCCvGvirw",
		"commitSummary": "Refine drag interaction, cursor states, and add bamboo mat",
	},
	{
		"prompt": "- If the drag position is below the ground, after projecting to the drag plane, project to the ground plane instead.\n- Add a divider between view tools and other tools.\n- The bamboo mat should work exactly like the seaweed currently does, just a light green instead.\n- The move ingredients tool should use the default cursor when nothing is hovered (and nothing is being dragged)",
		"id": "p6qm7FAYQXVPCrlsH",
		"commitSummary": "Improve drag logic, add toolbar divider, refine bamboo mat",
	},
	{
		"prompt": "When rice grains collide with other objects, add a constraint between them. Limit to 8 constraints per grain of rice, and one constraint between pairs of objects. Can store a Set of stuck objects on each grain object... or a Map of objects to constraints.\n\nDon't elide anything with \"// ...\" comments",
		"id": "COdJlZul2KU3hZdJL",
		"commitSummary": "Try to make rice sticky with constraints",
		"commitNote": `Note: The collide event is not listened to correctly;
it's supposed to be on the body, not the world.`,
	},
	{
		"prompt": "This is how the collide event works:\n\n          // When a body collides with another body, they both dispatch the \"collide\" event.\n          sphereBody.addEventListener(\"collide\",function(e){\n              console.log(\"Collided with body:\",e.body);\n              console.log(\"Contact between bodies:\",e.contact);\n          });",
		"id": "s1G1xn0sNQQGXDd48",
		"commitSummary": "Fix collide event usage",
		"commitNote": `Note: The AI decided to listen to the event for all object types,
even though only rice grains should be sticky. The only purpose this serves
is "justifying" the complexity of the collision handler.`,
	},
	{
		"prompt": "- When dragging rice, select all rice grains within a certain radius of the given rice grain, for dragging.\n- When deleting objects, delete all parts of an object made of multiple parts, or for rice, the rains within a certain radius.", // [sic]
		"id": "mWz3Cp1yDP72G7kJZ",
		"commitSummary": "Select nearby/related objects for dragging and deletion",
	},
	{
		"prompt": "- Don't grab all fish as one, or all nori sheets or bamboo sheets as one. Just select all the parts of a specific logical object at once.\n- Ensure things don't jump when starting a drag, by storing the offset that things would move at the start of the drag and subtracting it.\n- Break constraints if the `multiplier` of the constraint exceeds some threshold, adjustable in the panel with the debug viz checkbox.",
		"id": "Rzf3VJ3lG7vwhUd1k",
		"commitSummary": "Fix group dragging; try to break constraints on threshold",
	},
	{
		"prompt": "- If you use the exact logic for calculating the target position of each object to store offsets as is used to move the objects, the objects should not jump when starting to drag them. Right now it's fine for a single object, but a group of objects jumps.\n- Comment out the constraint breaking that uses .multiplier and note that equation.multiplier is only available on canon.js master, not in the latest release. Use distances instead to break constraints.",
		"id": "DSTVFJPezebvnurNN",
		"commitSummary": "Fix drag offset and constraint breaking logic",
	},
	{
		"prompt": "Use cannon-es, an ESM version of cannon.js which supports equation.multiplier",
		"id": "rfxlnOBIYOkHC6bwU",
		"commitSummary": "Switch to cannon-es for better constraint breaking (breaks breaking logic)",
	},
	{
		"prompt": "- Pin to cannon-es@0.20.0\n- Add a separate tool for dragging objects by a single object, with a pinching hand icon, if available.\n- Use the `contact` from the collide event to create constraints between the objects.",
		"id": "swj1vwSD8sLcYIvgt",
		"commitSummary": "Pin to cannon-es@0.20.0; add single object drag tool (breaks constraint creation)",
	},
	{
		"prompt": "Use LockConstraint instead for sticky connections",
		"id": "yir4SLaz8plVJ8d7r",
		"commitSummary": "Switch to LockConstraint for sticky connections (fixes constraints)",
	},
	// !continue and prompt before it combined below
	// {
	// 	"prompt": "- Simplify drag interaction by using an elevated version of the ground plane as the drag plane, with a configurable height.\n- When starting dragging rice, break connections between the dragged rice and other objects (but keep existing connections within the clump of rice to be dragged).\n- Make rice size configurable.\n- Add Q/E shortcuts to smoothly rotate the dragged group of objects about their center.\n- For touch, during a drag, replace the toolbar with a similarly styled button bar with rotate left and rotate right buttons. Handle pointer events on these buttons instead of click, to smoothly rotate during the drag.",
	// 	"id": "tKVC5f61W4crfcaC8",
	// 	"commitSummary": "Simplify drag interaction; add rotation shortcuts and touch controls",
	// },
	// {
	// 	"prompt": "!continue",
	// 	"id": "8oviZN0oQjkZSFaR2",
	// 	"commitSummary": "Continue previous implementation",
	// },
	{
		"prompt": "- Simplify drag interaction by using an elevated version of the ground plane as the drag plane, with a configurable height.\n- When starting dragging rice, break connections between the dragged rice and other objects (but keep existing connections within the clump of rice to be dragged).\n- Make rice size configurable.\n- Add Q/E shortcuts to smoothly rotate the dragged group of objects about their center.\n- For touch, during a drag, replace the toolbar with a similarly styled button bar with rotate left and rotate right buttons. Handle pointer events on these buttons instead of click, to smoothly rotate during the drag.",
		"id": "8oviZN0oQjkZSFaR2",
		"commitSummary": "Add rotation controls, rice size option; change drag behavior",
		"commitNote": `Note:
- Had to use !continue to finish the output.
- While the rotation controls where added, the touch was not handled continuously,
  requiring many many taps to rotate.
- Connected objects are not rotating about their collective center correctly.
  This is leading to crumping/twisting/instability.
- As for the drag plane, it doesn't work as intended,
  instead dragging directly on the ground, possibly because the
  drag offset handling is canceling out the lift height.`,
	},
	// omitting this version as it had significant regressions
	// 	{
	// 		"prompt": "- For small screens, allow the space between the icons in the toolbar to shrink as needed, and hide settings in a cog icon menu, and adding actions in a plus icon menu. Make these circular buttons with flyouts, rather than modals. Remove the object counts.\n- For touch, configure OrbitControls's `controls.touches` in `setMode`, and make rotation continuous while pressing the rotate left/right buttons.\n- Instead of having a separate drag plane, just project to the ground plane, with a configurable \"lift height\" (default 0.3); smoothly animate lifting objects to this height over a configurable \"lift time\" (default 300ms). Remove debug viz.\n- Highlight objects that will be affected by the current tool (none for camera tools, one for pinch tool, multiple for hand tool) instead of always one mesh.\n- Make sure grabbed objects rotate around their collective center.\n- Add shadows, with a directional light pointing straight down.",
	// 		"id": "CqvUrOjveBr3hyf3z",
	// 		"commitSummary": "Improve mobile UI, drag interaction, and add shadows.",
	// 		"commitNote": `Note: I saw significant regressions in this version;
	// The AI may be forgetting things at this scale.
	// Also, it didn't shrink the toolbar "as needed" as I asked,
	// but just compacted it, removing the divider as well. I was hoping for a more flexible layout.
	// It did add the cog and plus icon buttons with menus as requested,
	// although with major contrast issues.`,
	// 	}
];

async function downloadVersions(versions, outputDirectory, outputFileName) {
	const fs = require("fs");
	const { mkdir, writeFile, unlink } = require("fs/promises");
	const { Readable } = require('stream');
	const { finished } = require('stream/promises');
	const path = require("path");
	const { promisify } = require('util');
	const exec = promisify(require('child_process').exec)

	const downloadFile = (async (url, destination) => {
		const res = await fetch(url);
		const fileStream = fs.createWriteStream(destination, { flags: 'w' }); // allowing overwrites
		await finished(Readable.fromWeb(res.body).pipe(fileStream));
	});

	for (let i = 0; i < versions.length; i++) {
		const v = i + 1;
		const { id, prompt, commitSummary, commitNote } = versions[i];
		// Skip if already committed
		const { stdout, stderr } = await exec(`git log --oneline --fixed-strings --grep=${id}`);
		if (stderr) {
			console.error("Error from git log:", stderr);
			return;
		}
		if (stdout) {
			console.log(`Skipping version ${v} with ID ${id} as it is already mentioned in commit ${stdout.trim()}`);
			continue;
		}
		// Download the version
		const dlUrl = `https://party.websim.ai/api/v1/sites/${id}/html?raw=true`;
		const outputFilePath = `${outputDirectory}/${outputFileName}`;
		await mkdir(outputDirectory, { recursive: true });
		console.log(`Downloading version ${v} to ${outputFilePath}`);
		await downloadFile(dlUrl, outputFilePath);
		// Commit the version
		await exec(`git add ${outputFilePath}`);
		console.log(`Added version ${v} to git staging area`);
		const commitMessage = `${commitSummary || `Version ${v}`}

WebSim version link: https://websim.ai/c/${id}

Automatically downloaded from ${dlUrl}
via dl-websim-versions.js
${commitNote ? `\n${commitNote}\n` : ''}
LLM prompt:
${prompt}`;
		const commitMessageFile = "commit-message.txt";
		await writeFile(commitMessageFile, commitMessage);
		await exec(`git commit -F ${commitMessageFile}`);
		await unlink(commitMessageFile);
		console.log(`Committed version ${v}`);
	}
}
if (typeof window === 'undefined') {
	downloadVersions(versions, '.', 'index.html');
} else {
	collectVersionsInteractively();
}
