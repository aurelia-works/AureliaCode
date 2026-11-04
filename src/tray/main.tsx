import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "./tray.css";
import { Tray } from "./Tray";

// Separate entry from the app, like the HUD: no ptys, no hook listeners. It asks the back end when opened.
createRoot(document.getElementById("root")!).render(<Tray />);
