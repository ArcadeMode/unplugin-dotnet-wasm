(() => {
"use strict";
var __webpack_modules__ = ({
563(module, __unused_rspack_exports, __webpack_require__) {
module.exports = __webpack_require__.p + "static/assets/Library.3440cdd3.wasm";

},
916(module, __unused_rspack___webpack_exports__, __webpack_require__) {
__webpack_require__.a(module, async function (__rspack_load_async_deps, __rspack_async_done) { try {
/* import */ var dotnet_asset_test__rspack_import_0 = __webpack_require__(563);
/* import */ var _other_wasm__rspack_import_1 = __webpack_require__(619);
var __rspack_async_deps = __rspack_load_async_deps([_other_wasm__rspack_import_1]);
_other_wasm__rspack_import_1 = (__rspack_async_deps.then ? (await __rspack_async_deps)() : __rspack_async_deps)[0];

globalThis.__spikeWasmUrl = dotnet_asset_test__rspack_import_0;
globalThis.__userWasmFn = _other_wasm__rspack_import_1.f;

__rspack_async_done();
} catch(e) { __rspack_async_done(e); } });

},
619(module, exports, __webpack_require__) {
module.exports = __webpack_require__.v(exports, module.id, "1c9440020fd16b71" );

},

});
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
id: moduleId,
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

// webpack/runtime/async_module
(() => {
var hasSymbol = typeof Symbol === "function";
var rspackQueues = hasSymbol ? Symbol("rspack queues") : "__rspack_queues";
var rspackExports = __webpack_require__.aE = hasSymbol ? Symbol("rspack exports") : "__webpack_exports__";
var rspackError = hasSymbol ? Symbol("rspack error") : "__rspack_error";
var rspackDone = hasSymbol ? Symbol("rspack done") : "__rspack_done";
var rspackDefer = __webpack_require__.zS = hasSymbol ? Symbol("rspack defer") : "__rspack_defer";
var resolveQueue = (queue) => {
  if (queue && queue.d < 1) {
    queue.d = 1;
    queue.forEach((fn) => (fn.r--));
		queue.forEach((fn) => (fn.r-- ? fn.r++ : fn()));
	}
}
var wrapDeps = (deps) => {
	return deps.map((dep) => {
		if (dep !== null && typeof dep === "object") {
			if(!dep[rspackQueues] && dep[rspackDefer]) {
				var asyncDeps = dep[rspackDefer];
				var hasUnresolvedAsyncSubgraph = asyncDeps.some((id) => {
					var cache = __webpack_module_cache__[id];
					return !cache || cache[rspackDone] === false;
				});
				if (hasUnresolvedAsyncSubgraph) {
					var d = dep;
					dep = {
						then(callback) {
							Promise.all(asyncDeps.map(__webpack_require__)).then(() => (callback(d)))
						}
					};
				} else return dep;
			}
			if (dep[rspackQueues]) return dep;
			if (dep.then) {
				var queue = [];
				queue.d = 0;
				dep.then((r) => {
					obj[rspackExports] = r;
					resolveQueue(queue);
				},(e) => {
					obj[rspackError] = e;
					resolveQueue(queue);
				});
				var obj = {};
				obj[rspackDefer] = false;
				obj[rspackQueues] = (fn) => (fn(queue));
				return obj;
			}
		}
		var ret = {};
		ret[rspackQueues] = () => {};
		ret[rspackExports] = dep;
		return ret;
	});
};
__webpack_require__.a = (module, body, hasAwait) => {
	var queue;
	hasAwait && ((queue = []).d = -1);
	var depQueues = new Set();
	var exports = module.exports;
	var currentDeps;
	var outerResolve;
	var reject;
	var promise = new Promise((resolve, rej) => {
		reject = rej;
		outerResolve = resolve;
	});
	promise[rspackExports] = exports;
	promise[rspackQueues] = (fn) => { queue && fn(queue), depQueues.forEach(fn), promise["catch"](() => {}); };
	module.exports = promise;
	var handle = (deps) => {
		currentDeps = wrapDeps(deps);
		var fn;
		var getResult = () => {
			return currentDeps.map((d) => {
				if(d[rspackDefer]) return d;
				if (d[rspackError]) throw d[rspackError];
				return d[rspackExports];
			});
		}
		var promise = new Promise((resolve) => {
			fn = () => (resolve(getResult));
			fn.r = 0;
			var fnQueue = (q) => (q !== queue && !depQueues.has(q) && (depQueues.add(q), q && !q.d && (fn.r++, q.push(fn))));
			currentDeps.map((dep) => (dep[rspackDefer] || dep[rspackQueues](fnQueue)));
		});
		return fn.r ? promise : getResult();
	};
	var done = (err) => ((err ? reject(promise[rspackError] = err) : outerResolve(exports)), resolveQueue(queue), promise[rspackDone] = true);
	body(handle, done);
	queue && queue.d < 0 && (queue.d = 0);
};
})();
// webpack/runtime/public_path
(() => {
__webpack_require__.p = "/";
})();
// webpack/runtime/async_wasm_loading
(() => {

    __webpack_require__.v = function(exports, wasmModuleId, wasmModuleHash, importsObj) {
      
      var req = fetch(__webpack_require__.p + "static/wasm/" + wasmModuleHash.slice(0, 8) + ".module.wasm");
      var fallback = function() {
        return req
          .then(function(x) { return x.arrayBuffer();})
          .then(function(bytes) { return WebAssembly.instantiate(bytes, importsObj);})
          .then(function(res) { return Object.assign(exports, res.instance.exports);});

      }
      
      return req.then(function(res) {
        if (typeof WebAssembly.instantiateStreaming === "function") {
          return WebAssembly.instantiateStreaming(res, importsObj)
            .then(
              function(res) { return Object.assign(exports, res.instance.exports);},
              function(e) {
                if(res.headers.get("Content-Type") !== "application/wasm") {
                  console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
                  return fallback();
                }
                throw e;
              }
            );
        }
        return fallback();
      });

    };

})();
// startup
// Load entry module and return exports
// This entry module used 'module' so it can't be inlined
var __webpack_exports__ = __webpack_require__(916);
})()
;