# UI Style Guide

The goal of this guide is to let another AI continue development without changing the product's visual identity.

## Design tokens

Use the variables in `apps/web/src/styles.css` rather than introducing a second palette.

- Accent: `#f97316` orange.
- Accent contrast: dark ink in light mode.
- Light surfaces: warm white and stone neutrals.
- Dark surfaces: stone/brown neutrals.
- Text: stone ink in light mode, warm white in dark mode.
- Borders: subtle warm gray; never use heavy black borders.
- Success: emerald/green. Danger: red. Warning/highlights: amber/orange.
- CSS variables: `--surface`, `--surface-muted`, `--surface-elevated`, `--panel`, `--text`, `--muted`, `--border`, `--input-bg`, `--hover-bg`, `--accent`, `--danger`, `--success`.

## Typography

- Font stack: `Noto Sans SC`, `PingFang SC`, `Microsoft YaHei`, system UI, sans-serif.
- Use compact bold headings and smaller muted supporting text.
- Keep Chinese copy direct and short.
- Do not add a new font family unless explicitly approved.

## Shape, spacing and elevation

- Main cards and panels: large rounded corners, commonly Tailwind `rounded-2xl` or `rounded-[2rem]`.
- Buttons and inputs: `rounded-xl` or `rounded-lg`.
- Course cards: compact corners and a colored left edge.
- Use generous spacing and readable touch targets; mobile buttons commonly use `min-h-11` or `min-h-12`.
- Prefer soft borders and subtle shadows over flat hard-edged panels.
- Glass-like surfaces are reserved for sticky navigation and overlays: `.glass`, `.border-app`.

## Themes

- Light and dark mode are both first-class.
- Dark mode uses the `.dark` class and Tailwind `dark:` variants.
- Never hardcode a color if an existing semantic variable or Tailwind theme token matches.
- Check text contrast in both modes before accepting a UI change.
- Dynamic course colors must use `color-mix` or the existing `--course-color` approach; do not force black or white text.

## Layout

- Desktop: left sidebar, sticky top header, spacious calendar/content area.
- Mobile: compact sticky header, bottom navigation with four main destinations, safe-area padding via `.safe-top` and `.safe-bottom`.
- Calendar and timetable views use full-width responsive containers.
- Timetable headers and period columns stay fixed while the grid scrolls.
- Do not replace the existing desktop/mobile navigation model without approval.

## Component patterns

- Buttons: orange filled button for primary action; bordered or transparent button for secondary action; red only for destructive action.
- Inputs: bordered, rounded, `bg-[var(--input-bg)]`, clear focus state and visible placeholder.
- Dialog: use the existing Radix Dialog or established custom modal pattern; modal masks must cover fixed timetable layers.
- Cards: soft surface, border, rounded corners and concise text hierarchy.
- Tags: preserve tag color and readable text contrast.
- Calendar: keep FullCalendar customization in `styles.css`; use existing event colors and priority left borders.
- Course timetable: preserve compact grid typography, exact-time labels, conflict marker and horizontal scrolling.
- Status: partial tasks remain visually distinct but are not treated as completed.

## Interaction rules

- Keep all current views, routes and navigation destinations.
- Preserve drag, resize, selection, long-press, scroll and keyboard behavior.
- Use familiar icons from `lucide-react`.
- Use short Chinese labels.
- Avoid adding decorative animations or changing transition timing globally.

## Do not

- Do not introduce shadcn/ui, Ant Design, MUI, Chakra or another component library.
- Do not replace Tailwind with styled-components, CSS modules or a new design system.
- Do not redesign the shell, calendar, timetable or settings simply because a new component is added.
- Do not remove responsive or dark-mode behavior.
