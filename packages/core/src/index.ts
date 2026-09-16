/** @inkforge/core — public surface. Subpath exports keep imports tree-shakeable. */
export * from "./book/index";
export * from "./humanize/index";
export * from "./formatting/index";
export * from "./export/index";
export {
  validateEpub,
  locateEpubcheckJar,
  type EpubCheckMessage,
  type EpubCheckResult,
} from "./validate/epubcheck";
