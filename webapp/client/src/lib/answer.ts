/**
 * Back-compat re-export. The renderer now lives in the shared markdown pipeline
 * (`./markdown`) so the editor preview, artifact viewer, and chat bubbles all
 * share one parser, sanitiser, and set of client-side enhancements.
 */
export { renderAnswer } from './markdown';
