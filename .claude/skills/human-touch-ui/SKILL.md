---
name: human-touch-ui
description: Polishes websites and app UIs so they feel crafted by a thoughtful human designer, not AI-generated. Use when building or refining any page, dashboard, form, or component, or when the user asks for a more professional, polished, or human feel.
---

# Human-Touch UI

Apply these to every interface you build or edit. Where they conflict with an existing design system, the design system wins.

## 1. Avoid the "AI look"
- No default purple/blue gradients, glassmorphism everywhere, or emoji used as icons.
- No generic hero copy ("Unlock the power of...", "Seamless", "Revolutionize"). Write specific, plain sentences about what the product actually does.
- Do not make every section a centered card grid. Vary the layouts: split columns, asymmetric blocks, full-bleed bands.
- Use one consistent icon set (e.g. Lucide or Phosphor), never mixed sets.

## 2. Typography carries the professionalism
- Pick at most 2 typefaces: one for headings, one for body. Use a type scale (e.g. 12/14/16/20/24/32/40) and keep to it.
- Body text 16px minimum, line-height 1.5–1.7, line length 60–75 characters.
- Use font weight and size for hierarchy before reaching for color.
- Use tabular numerals (`font-variant-numeric: tabular-nums`) in tables, prices, and results.

## 3. Color with restraint
- Neutral base (slightly warm or cool greys, not pure #000 / #fff), one primary brand color, one accent. Semantic colors (success, warning, danger) used only for status.
- Define colors as CSS variables / tokens; support dark mode by redefining the tokens.
- Check contrast: 4.5:1 for body text, 3:1 for large text and UI controls.

## 4. Spacing and rhythm
- Use a 4px or 8px spacing scale and nothing in between.
- Give content room: generous section padding, consistent gaps inside cards.
- Align everything to a grid; ragged left edges look careless.

## 5. Write like a person
- Buttons say what happens: "Save result", "Send report", not "Submit" or "OK".
- Error messages say what went wrong and how to fix it, in plain words, without blaming the user.
- Empty states explain what will appear here and offer the first action.
- Use sentence case for headings and buttons.

## 6. Details that signal care
- Every interactive element has hover, focus-visible, active, and disabled states.
- Loading: skeletons for content, spinners only for short actions; never a blank screen.
- Subtle motion only: 150–250ms ease-out transitions; respect `prefers-reduced-motion`.
- Consistent border radius across the app (pick one or two values).
- Soft, layered shadows rather than one harsh drop shadow.
- Real-looking sample data (realistic names, dates, values), never "Lorem ipsum" or "John Doe" in final screens.

## 7. Software and dashboards
- Put the most important number or action first; secondary detail below or behind a click.
- Tables: left-align text, right-align numbers, sticky headers, zebra or hover rows for long lists.
- Forms: labels above fields, helpful hint text, inline validation after the user leaves a field, logical grouping with clear section headings.
- Flag critical or out-of-range values with color AND an icon or label, never color alone.

## 8. Responsive and accessible by default
- Design mobile-first; test at 375px, 768px, 1280px. No horizontal scrolling on phones.
- Tap targets at least 44×44px.
- Semantic HTML, alt text on images, labels on every input, full keyboard navigation.

## Before finishing
Review the result against this list and fix anything that looks templated, cramped, inconsistent, or unclear before presenting it.
