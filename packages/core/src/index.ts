/** @inkforge/core — public surface. Subpath exports keep imports tree-shakeable. */
export * from "./book/index";
export * from "./outline/index";
export * from "./draft/index";
export * from "./humanize/index";
export * from "./formatting/index";
export * from "./export/index";
export * from "./consistency/index";
export * from "./voiceprint/index";
export * from "./aeo/index";
export * from "./onix/index";
export * from "./print/index";
export * from "./accessibility/index";
export * from "./market/index";
export * from "./rights/index";
export * from "./sales/index";
export * from "./simulation/index";
export * from "./series/index";
export * from "./edge/cover-ab";
export * from "./edge/backlist";
export * from "./edge/bundles";
export * from "./edge/d2c";
export * from "./edge/marketplace";
export * from "./edge/whitelabel";
export * from "./edge/localization";
export * from "./edge/arbitrage";
export * from "./research/coverage";
export * from "./research/e1-fiction";
export * from "./research/e2-nonfiction";
export * from "./research/e3-academic";
export * from "./research/e4-b2b";
export * from "./research/e5-childrens";
export * from "./research/e6-international";
export {
  validateEpub,
  locateEpubcheckJar,
  type EpubCheckMessage,
  type EpubCheckResult,
} from "./validate/epubcheck";
