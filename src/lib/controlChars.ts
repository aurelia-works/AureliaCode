// Control characters a text box should never hold. Tab, newline and return stay.
const STRAY = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const count = (text: string, char: string) => text.split(char).length - 1;

/** Removes stray characters. 0x1C and 0x1D are the left and right arrow keys arriving as text, so they still move the caret. */
export function dropStray(value: string, caret: number): { value: string; caret: number } {
  const clean = value.replace(STRAY, "");
  if (clean === value) return { value, caret };
  const before = value.slice(0, caret);
  const steps = count(before, "\x1d") - count(before, "\x1c");
  const next = before.replace(STRAY, "").length + steps;
  return { value: clean, caret: Math.max(0, Math.min(clean.length, next)) };
}

/** The value to keep from a textarea's change event, with the caret put right if anything was removed. */
export function cleanTextarea(el: HTMLTextAreaElement): string {
  const next = dropStray(el.value, el.selectionStart);
  if (next.value !== el.value) {
    el.value = next.value;
    el.setSelectionRange(next.caret, next.caret);
  }
  return next.value;
}
