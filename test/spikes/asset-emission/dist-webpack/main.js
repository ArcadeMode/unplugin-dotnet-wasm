/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The require scope
/******/ 	const __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/publicPath */
/******/ 	(() => {
/******/ 		__webpack_require__.p = "";
/******/ 	})();
/******/ 	
/************************************************************************/

;// ../../fixtures/Library/bin/Debug/net10.0/wwwroot/_framework/Library.wasm
const Library_namespaceObject = __webpack_require__.p + "assets/Library-862ba95d14ea8a7532b7.wasm";
;// ./src/entry.mjs


// Rollup emits ESM by default; webpack emits CJS by default. Log via a global
// so `run.mjs` can grep for the URL/module id in both bundles.
globalThis.__spikeWasmUrl = Library_namespaceObject;

/******/ })()
;