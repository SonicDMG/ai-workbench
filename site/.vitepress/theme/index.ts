// Custom VitePress theme entry — extends the default theme with a
// brand-aware stylesheet and (later) custom Vue components in the
// hero slots. Loaded via `srcDir: .docs-staged` because the stager
// copies this whole theme/ directory into `.docs-staged/.vitepress/`
// alongside the staged config.

import DefaultTheme from "vitepress/theme";
import "./style.css";

export default DefaultTheme;
