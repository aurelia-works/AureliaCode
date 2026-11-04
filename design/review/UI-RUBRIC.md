# UI rubric

`npm run ui-score` and UI reviews score screenshots against this, 1 to 10 for each category.
The overall score is the mean. 8 is the bar for shipping a redesign. Score harshly: 10 means
nothing left to fix, 7 means good but clearly behind the best agent apps (Claude desktop, Codex,
T3 Code), 5 means a person would hit a real problem.

- **Typography:** a clear type scale (no more than 4 sizes on a screen), readable line length,
  tabular numbers where numbers change, no truncation hiding what something is.
- **Hierarchy:** the conversation is the focus. The one thing to do next stands out, and
  secondary controls recede.
- **Spacing:** one spacing scale, aligned edges, related things grouped, no cramped or
  floating elements.
- **Color and contrast:** text meets WCAG AA. Colour means state (working, needs you, failed,
  done) and is used for nothing else. Both themes hold up.
- **Iconography:** one icon set and one stroke weight; every icon-only button has a label on
  hover; no emoji standing in for icons.
- **Consistency:** the same thing looks and behaves the same everywhere (buttons, menus,
  chips, dialogs).
- **Clarity:** someone new can tell what each control does and what state the thread is in
  without reading docs. Empty and error states say what to do.
- **Agent legibility:** at a glance you can see what each agent is doing, what it is waiting on,
  what it changed, and how far along a goal or plan is.
