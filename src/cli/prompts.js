'use strict';

/** Interactive prompt helpers for the setup wizards. */

async function ask(rl, label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askRequired(rl, label, defaultValue = '') {
  while (true) {
    const value = await ask(rl, label, defaultValue);
    if (value) return value;
    console.log('This value is required.');
  }
}

async function yesNo(rl, label, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function choose(rl, title, options, defaultIndex = 0) {
  console.log('');
  console.log(title);
  options.forEach((option, index) => {
    const marker = index === defaultIndex ? ' ← default' : '';
    console.log(`  ${index + 1}. ${option.label}${marker}`);
  });

  while (true) {
    const raw = await ask(rl, 'Choose', String(defaultIndex + 1));
    const index = Number(raw) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      return options[index].value;
    }
    console.log(`Please enter 1-${options.length}.`);
  }
}

module.exports = { ask, askRequired, yesNo, choose };
