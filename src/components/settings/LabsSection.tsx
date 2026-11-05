import { PrefSwitches, type Switch } from "./ThreadsSection";

/** Cosmetic and trial features: off unless you turn them on. */
const LABS: Switch[] = [
  { key: "jellyIcons", label: "Jellyfish state icons in the thread list", hint: "Off: the same status icons as everywhere else" },
  { key: "bloom", label: "Jellyfish on the start screen", hint: "One per live thread" },
  { key: "headerModeChip", label: "Branch, cost, mode and account chips in the thread header", hint: "The sidebar row and the composer already show them" },
];

export function LabsSection() {
  return (
    <section className="set-group">
      <h3>Labs</h3>
      <p className="hint">Cosmetic and trial features, off unless you turn them on. Changes apply straight away.</p>
      <PrefSwitches items={LABS} />
    </section>
  );
}
