# PromptRelay Dashboard UI Redesign & Defect Audit

## Confirmed Defect 1: Add Provider Modal Opens Blank
- **Observed Behavior**: Clicking "Add Provider" opens a modal dialog showing the header "Add Provider" and the first step indicator "1 Provider", but the body and footer remain completely blank.
- **Root Cause**: In [dashboard/js/pages/providers.js](file:///c:/Users/Monem089/Documents/New%20folder%20%282%29/dashboard/js/pages/providers.js), `renderStepper()` iterated over `STEP_LABELS` with `cls = i === wiz.step ? 'active' : i < wiz.step ? 'done' : ''`. For step `i = 1`, `cls` was `""` (empty string). This invoked `h('div.stepper-dot.' + cls, ...)` which generated a tag string ending in a trailing dot (`div.stepper-dot.`). In [dashboard/js/ui.js](file:///c:/Users/Monem089/Documents/New%20folder%20%282%29/dashboard/js/ui.js), `h()` split by `/(?=[.#])/` resulting in an empty class token `""`. Calling `el.classList.add("")` threw an uncaught DOM exception:
  `SyntaxError: Failed to execute 'add' on 'DOMTokenList': The token provided must not be empty.`
  This fatal uncaught exception halted `render()` immediately during step 1 before `renderChoose()` could execute, leaving `bodyEl` and `footEl` completely unpopulated.
- **Affected File/Function**:
  - `dashboard/js/pages/providers.js` -> `openWizard()`, `renderStepper()`
  - `dashboard/js/ui.js` -> `h()` (hyperscript helper lacked sanitization against empty class tokens)
- **Implemented Fix**:
  - Sanitized class token parsing in `h()` in `dashboard/js/ui.js` so empty tokens are ignored.
  - Fixed class concatenation in `renderStepper()` to conditionally append classes only when non-empty.
  - Rebuilt the entire Add Provider workflow into a modern 6-step guided modal flow with rich state machines, live testing animations, discovery skeletons, and sanitized review.
- **Verification Evidence**:
  - Reproduced via Chrome DevTools Protocol (CDP) session against running PromptRelay gateway (`node scratch/test-reproduce.js`), capturing exact browser exception and blank modal inspection.
  - Automated unit and browser tests verify step-1 options render cleanly without DOM exceptions.

## Confirmed Defect 2: Client Cards Layout & Windows Path Overflow
- **Observed Behavior**: In 3-column layouts, client cards overflow or become cramped; Windows filesystem paths (e.g. `C:\Users\Monem089\.config\opencode\opencode.jsonc`) break out of card boundaries; action buttons push below viewports.
- **Root Cause**: Fixed grid constraints without `minmax()` boundaries or `min-width: 0` child protection. Paths lacked truncation, tooltips, and copy buttons.
- **Affected File/Function**: `dashboard/js/pages/clients.js` (`clientCard()`), `dashboard/css/styles.css` (`.grid-cards`, `.client-card`).
- **Implemented Fix**:
  - Switched to intrinsic responsive grid (`auto-fit, minmax(280px, 1fr)`) with `min-width: 0` on all card children.
  - Implemented middle-truncated path display with full-path hover tooltip and inline one-click Copy action.
  - Streamlined card height and action layout with compact button groupings.

## Confirmed Defect 3: Sidebar Clipping on Short Viewports
- **Observed Behavior**: Bottom items (Settings, theme toggles, status pills) clip or disappear when browser viewport height is under 750px.
- **Root Cause**: `.sidebar` was styled as a non-scrolling flex column with `overflow: hidden`, while only `.nav` scrolled.
- **Affected File/Function**: `dashboard/css/styles.css` (`.sidebar`, `.sidebar-bottom`).
- **Implemented Fix**: Added independent scroll container for sidebar navigation and bottom actions, ensuring all items remain accessible at any desktop height.

## Confirmed Defect 4: Missing Official Brand Logos & Generic Identity
- **Observed Behavior**: Generic user/folder icons were used repeatedly across OpenCode, Claude Code, and Hermes; providers lacked visual logos.
- **Root Cause**: No SVG asset library existed in `dashboard/assets`.
- **Affected File/Function**: `dashboard/assets/providers/`, `dashboard/js/ui.js` (`logo()`, `LOGO_REGISTRY`).
- **Implemented Fix**:
  - Integrated official SVG logos for PromptRelay, Anthropic / Claude Code, OpenCode, Hermes / Nous Research, OpenAI, Ollama, OpenRouter, Google Gemini, Azure OpenAI, Groq, Mistral, xAI, DeepSeek, Together AI, Fireworks AI, NVIDIA, Cerebras, and SambaNova.
  - Created centralized logo registry with accessible titles and polished monogram fallbacks.
  - Documented sources and licensing in `dashboard/assets/providers/SOURCES.md`.

## Confirmed Defect 5: Generic Dark Purple Aesthetic
- **Observed Behavior**: Purple-on-black color scheme felt generic and did not reflect the requested local gateway identity.
- **Root Cause**: Hardcoded dark-first palette (`--violet: #7c5cff`, `--bg-base: #0a0a0f`).
- **Affected File/Function**: `dashboard/css/styles.css`, `dashboard/index.html`.
- **Implemented Fix**:
  - Replaced design tokens with light-first semantic palette:
    - Canvas: `#f7faff` (crisp white/subtle blue)
    - Primary: `#2563eb` (clear reliable blue)
    - Accent: `#ec4899` (restrained pink)
    - Surfaces: `#ffffff`, `#f1f6ff`, `#eaf2ff`
    - High-contrast text: `#14213d`, `#52627a`, `#738198`
  - Added compatible high-contrast dark variant preserving the blue-pink brand identity.
