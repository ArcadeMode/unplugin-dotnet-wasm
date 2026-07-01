(() => {
"use strict";
var __webpack_modules__ = ({});
// The module cache
var __webpack_module_cache__ = {};

// The require function
function __webpack_require__(moduleId) {

// Check if module is in cache
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
// Create a new module (and put it into the cache)
var module = (__webpack_module_cache__[moduleId] = {
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

// webpack/runtime/public_path
(() => {
__webpack_require__.p = "";
})();
// webpack/runtime/rspack_version
(() => {
__webpack_require__.rv = () => ("1.7.12")
})();
// webpack/runtime/rspack_unique_id
(() => {
__webpack_require__.ruid = "bundler=rspack@1.7.12";
})();

;// CONCATENATED MODULE: ../../fixtures/Library/bin/Debug/net10.0/wwwroot/_framework/Library.wasm
const Library_namespaceObject = __webpack_require__.p + "assets/Library-3440cdd3758b782c.wasm";
;// CONCATENATED MODULE: ./src/entry.mjs


// Rollup emits ESM by default; webpack emits CJS by default. Log via a global
// so `run.mjs` can grep for the URL/module id in both bundles.
globalThis.__spikeWasmUrl = Library_namespaceObject;

})()
;