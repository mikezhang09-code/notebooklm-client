/**
 * Inline SVG icon system (ported verbatim from the design handoff sprite).
 *
 * <IconSprite/> is mounted once at the app root; it injects every `<g id="i-…">`
 * definition. <Icon id="i-nlm"/> then references one via <use>. Icons inherit
 * `currentColor` and are sized by their CSS context (the design system sets
 * width/height on `… svg` selectors), so no size prop is usually needed.
 */

/** The full `<defs>` block from the prototype's sprite. */
const SPRITE_DEFS = `
<g id="i-book"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM19 18v3H6.5A1.5 1.5 0 0 1 5 19.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-nlm"><rect x="4.5" y="3.5" width="12" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 8h12M8 3.5v17" stroke="currentColor" stroke-width="1.4"/><path d="M18.5 9.5l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="currentColor" stroke="none"/></g>
<g id="i-folder"><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h3.6a1.5 1.5 0 0 1 1.1.5l1 1.2h7.3A1.5 1.5 0 0 1 20 8.7v9.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g>
<g id="i-folders"><path d="M7 8.5V7a1.5 1.5 0 0 1 1.5-1.5h2.4a1.5 1.5 0 0 1 1.1.5l.9 1h5.1A1.5 1.5 0 0 1 19.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="3.5" y="8.5" width="14.5" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
<g id="i-audio"><path d="M4 10v4M7.5 7v10M11 4.5v15M14.5 8v8M18 10.5v3M21 11.5v1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g>
<g id="i-report"><path d="M6.5 3.5h7L18 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 3.5V8h5M8.5 12h7M8.5 15h7M8.5 18h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g>
<g id="i-video"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.5l4.5 2.5L10 14.5z" fill="currentColor"/></g>
<g id="i-quiz"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2-2.6 3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1" fill="currentColor"/></g>
<g id="i-flash"><rect x="6.5" y="6.5" width="13" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-info"><path d="M5 19.5V11M9.5 19.5V7M14 19.5v-6M18.5 19.5V9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 19.5h17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></g>
<g id="i-slides"><rect x="3.8" y="4.5" width="16.4" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 15.5v3m-3 1h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-table"><rect x="3.8" y="5" width="16.4" height="14" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 9.5h16.4M3.8 14h16.4M9.5 5v14" stroke="currentColor" stroke-width="1.4"/></g>
<g id="i-mind"><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="18" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="18" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.3 10.5L6.4 7.4M13.7 10.5l3.9-3.1M10.3 13.5l-3.9 3.1M13.7 13.5l3.9 3.1" stroke="currentColor" stroke-width="1.4"/></g>
<g id="i-search"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15 15l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-plus"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>
<g id="i-refresh"><path d="M19 9a7 7 0 1 0 .9 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M19 4v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-ext"><path d="M14 5h5v5M19 5l-8 8M17 14v4.5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 5 18.5v-11a.5.5 0 0 1 .5-.5H10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-trash"><path d="M5.5 7h13M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7m2 0l-.7 11.1a1.5 1.5 0 0 1-1.5 1.4H8.7a1.5 1.5 0 0 1-1.5-1.4L6.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-sun"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-moon"><path d="M19 13.5A7.5 7.5 0 0 1 9.5 4 7.5 7.5 0 1 0 19 13.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g>
<g id="i-spark"><path d="M12 4l1.6 4.6L18 10l-4.4 1.4L12 16l-1.6-4.6L6 10l4.4-1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></g>
<g id="i-chat"><path d="M4.5 5.5h15v10h-9l-4 3v-3h-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g>
<g id="i-close"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g>
<g id="i-back"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-chev"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-down"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-filter"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g>
<g id="i-grid"><rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
<g id="i-rows"><rect x="4" y="5" width="16" height="4.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="14.5" width="16" height="4.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
<g id="i-download"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-upload"><path d="M12 16V5m0 0L8 9m4-4l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-share"><circle cx="6" cy="12" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="18" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11l7-4M8 13l7 4" stroke="currentColor" stroke-width="1.5"/></g>
<g id="i-more"><circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/></g>
<g id="i-check"><path d="M5 12.5l4.5 4.5L19 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-link"><path d="M9.5 14.5l5-5M8 11l-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2M16 13l2-2A3.2 3.2 0 0 0 13.5 6.5l-2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-clock"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-layers"><path d="M12 4l8 4-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></g>
<g id="i-gear"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5l1.3 2.2 2.5-.4.4 2.5 2.2 1.3-1.1 2.3 1.1 2.3-2.2 1.3-.4 2.5-2.5-.4L12 20.5l-1.3-2.2-2.5.4-.4-2.5-2.2-1.3 1.1-2.3-1.1-2.3 2.2-1.3.4-2.5 2.5.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></g>
<g id="i-pulse"><path d="M3 12h4l2-6 4 13 2.5-7H21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="i-doc"><rect x="5" y="3.5" width="14" height="17" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g>
<g id="i-copy"><rect x="8.5" y="8.5" width="11" height="11" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 15.5A1.5 1.5 0 0 1 4 14V5.5A1.5 1.5 0 0 1 5.5 4H14a1.5 1.5 0 0 1 1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>
<g id="i-stop"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/></g>
`;

export function IconSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: `<defs>${SPRITE_DEFS}</defs>` }}
    />
  );
}

export function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}
