/**
 * `$skill` in the composer, as in Codex. Claude Code only runs a skill named as the first word
 * (`/skill`), so a leading `$name` becomes `/name`; one later in the message becomes
 * `the "name" skill`, which Claude loads with its Skill tool. Only known names change, so a
 * price ($5) or a shell variable ($HOME) goes through as typed.
 */
export function expandSkillRefs(text: string, names: string[]): string {
  const known = new Set(names);
  return text.replace(/(^|\s)\$([A-Za-z][\w:.-]*)/g, (all, lead: string, name: string, at: number) => {
    if (!known.has(name)) return all;
    return at === 0 && lead === "" ? `/${name}` : `${lead}the "${name}" skill`;
  });
}

/** The `$word` being typed at the end of `beforeCaret`, or undefined when the caret isn't in one. */
export function skillQuery(beforeCaret: string): string | undefined {
  return /(?:^|\s)\$([\w:.-]*)$/.exec(beforeCaret)?.[1];
}
