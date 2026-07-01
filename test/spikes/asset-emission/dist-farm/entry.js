window['361ed0f21b388038be2dd935ad449941'] = {__FARM_TARGET_ENV__: 'browser'};function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) return obj;
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") return {
        default: obj
    };
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) return cache.get(obj);
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key, desc);
            else newObj[key] = obj[key];
        }
    }
    newObj.default = obj;
    if (cache) cache.set(obj, newObj);
    return newObj;
}function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}((function(){const __global_this__ = typeof globalThis !== 'undefined' ? globalThis : window;
var index_js_default = {
    name: 'farm-runtime-import-meta',
    _moduleSystem: {},
    bootstrap (system) {
        this._moduleSystem = system;
    },
    moduleCreated (module) {
        const publicPath = this._moduleSystem.publicPaths?.[0] || "";
        const isSSR = this._moduleSystem.targetEnv === "node";
        const { location } = __global_this__;
        let baseUrl;
        try {
            baseUrl = (location ? new URL(publicPath, `${location.protocol}//${location.host}`) : new URL(module.resource_pot)).pathname;
        } catch (_) {
            baseUrl = '/';
        }
        module.meta.env = {
            ...{
                "NODE_ENV": "production",
                "mode": "production"
            } ?? {},
            dev: "production" === 'development',
            prod: "production" === 'production',
            BASE_URL: baseUrl,
            SSR: isSSR
        };
        const url = location ? `${location.protocol}//${location.host}${publicPath.replace(/\/$/, '')}/${module.id}?t=${Date.now()}` : module.resource_pot;
        module.meta.url = url;
    }
};

class Module {
    constructor(id, require){
        this.resource_pot = "";
        this.id = id;
        this.exports = {};
        this.meta = {
            env: {}
        };
        this.require = require;
    }
    o(to, to_k, get) {
        Object.defineProperty(to, to_k, {
            enumerable: true,
            get
        });
    }
    d(to, to_k, val) {
        this.o(to, to_k, function() {
            return val;
        });
    }
    _m(to) {
        const key = '__esModule';
        if (to[key]) return;
        Object.defineProperty(to, key, {
            value: true
        });
    }
    _e(to, from) {
        Object.keys(from).forEach(function(k) {
            if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
                Object.defineProperty(to, k, {
                    value: from[k],
                    enumerable: true,
                    configurable: true
                });
            }
        });
        return from;
    }
    i(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }
    _g(nodeInterop) {
        if (typeof WeakMap !== "function") return null;
        var cacheBabelInterop = new WeakMap();
        var cacheNodeInterop = new WeakMap();
        return (this._g = function(nodeInterop) {
            return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
        })(nodeInterop);
    }
    w(obj, nodeInterop) {
        if (!nodeInterop && obj && obj.__esModule) return obj;
        if (obj === null || typeof obj !== "object" && typeof obj !== "function") return {
            default: obj
        };
        var cache = this._g(nodeInterop);
        if (cache && cache.has(obj)) return cache.get(obj);
        var newObj = {
            __proto__: null
        };
        var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
        for(var key$1 in obj){
            if (key$1 !== "default" && Object.prototype.hasOwnProperty.call(obj, key$1)) {
                var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key$1) : null;
                if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key$1, desc);
                else newObj[key$1] = obj[key$1];
            }
        }
        newObj.default = obj;
        if (cache) cache.set(obj, newObj);
        return newObj;
    }
    _(to, to_k, from, from_k) {
        this.d(to, to_k, from[from_k || to_k]);
    }
    p(to, val) {
        for (const key$2 of Object.keys(val)){
            const newKey = to[key$2];
            if (newKey && !Object.prototype.hasOwnProperty.call(val, newKey)) {
                this.d(val, newKey, val[key$2]);
            }
        }
    }
    f(v) {
        if (typeof v.default !== 'undefined') {
            return v.default;
        }
        return v;
    }
}

class FarmRuntimePluginContainer {
    constructor(plugins){
        this.plugins = [];
        this.plugins = plugins;
    }
    hookSerial(hookName, ...args) {
        for (const plugin of this.plugins){
            const hook = plugin[hookName];
            if (hook) {
                hook.apply(plugin, args);
            }
        }
    }
    hookBail(hookName, ...args) {
        for (const plugin$1 of this.plugins){
            const hook$1 = plugin$1[hookName];
            if (hook$1) {
                const result = hook$1.apply(plugin$1, args);
                if (result) {
                    return result;
                }
            }
        }
        return undefined;
    }
}

const __farm_global_this__ = window['361ed0f21b388038be2dd935ad449941'];
const __global_this__$1 = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {};
const targetEnv = __farm_global_this__.__FARM_TARGET_ENV__ || 'node';
const isBrowser = targetEnv === 'browser' && __global_this__$1.document;
class ResourceLoader {
    constructor(moduleSystem, publicPaths){
        this.moduleSystem = moduleSystem;
        this._loadedResources = {};
        this._loadingResources = {};
        this.publicPaths = publicPaths;
    }
    load(resource, index = 0) {
        if (!isBrowser) {
            const result$1 = this.moduleSystem.pluginContainer.hookBail('loadResource', resource);
            if (result$1) {
                return result$1.then((res)=>{
                    if (!res.success && res.retryWithDefaultResourceLoader) {
                        if (resource.type === 0) {
                            return this._loadScript(`./${resource.path}`);
                        } else if (resource.type === 1) {
                            return this._loadLink(`./${resource.path}`);
                        }
                    } else if (!res.success) {
                        throw new Error(`[Farm] Failed to load resource: "${resource.path}, type: ${resource.type}". Original Error: ${res.err}`);
                    }
                });
            } else {
                if (resource.type === 0) {
                    return this._loadScript(`./${resource.path}`);
                } else if (resource.type === 1) {
                    return this._loadLink(`./${resource.path}`);
                }
            }
        }
        const publicPath = this.publicPaths[index];
        const url = `${publicPath.endsWith('/') ? publicPath.slice(0, -1) : publicPath}/${resource.path}`;
        if (this._loadedResources[resource.path]) {
            return Promise.resolve();
        } else if (this._loadingResources[resource.path]) {
            return this._loadingResources[resource.path];
        }
        const result$2 = this.moduleSystem.pluginContainer.hookBail('loadResource', resource);
        if (result$2) {
            return result$2.then((res)=>{
                if (res.success) {
                    this.setLoadedResource(resource.path);
                } else if (res.retryWithDefaultResourceLoader) {
                    return this._load(url, resource, index);
                } else {
                    throw new Error(`[Farm] Failed to load resource: "${resource.path}, type: ${resource.type}". Original Error: ${res.err}`);
                }
            });
        } else {
            return this._load(url, resource, index);
        }
    }
    setLoadedResource(path, loaded = true) {
        this._loadedResources[path] = loaded;
    }
    isResourceLoaded(path) {
        return this._loadedResources[path];
    }
    _load(url, resource, index) {
        let promise = Promise.resolve();
        if (resource.type === 0) {
            promise = this._loadScript(url);
        } else if (resource.type === 1) {
            promise = this._loadLink(url);
        }
        this._loadingResources[resource.path] = promise;
        promise.then(()=>{
            this._loadedResources[resource.path] = true;
            this._loadingResources[resource.path] = null;
        }).catch((e)=>{
            console.warn(`[Farm] Failed to load resource "${url}" using publicPath: ${this.publicPaths[index]}`);
            index++;
            if (index < this.publicPaths.length) {
                return this._load(url, resource, index);
            } else {
                this._loadingResources[resource.path] = null;
                throw new Error(`[Farm] Failed to load resource: "${resource.path}, type: ${resource.type}". ${e}`);
            }
        });
        return promise;
    }
    _loadScript(path) {
        if ("browser" !== 'browser') {
            return import(path);
        } else {
            return new Promise((resolve, reject)=>{
                const script = document.createElement('script');
                script.src = path;
                document.body.appendChild(script);
                script.onload = ()=>{
                    resolve();
                };
                script.onerror = (e)=>{
                    reject(e);
                };
            });
        }
    }
    _loadLink(path) {
        if ("browser" !== 'browser') {
            return Promise.resolve();
        } else {
            return new Promise((resolve, reject)=>{
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = path;
                document.head.appendChild(link);
                link.onload = ()=>{
                    resolve();
                };
                link.onerror = (e)=>{
                    reject(e);
                };
            });
        }
    }
}
var resource_loader_js_ns = {
    ResourceLoader: ResourceLoader,
    __farm_global_this__: __farm_global_this__,
    __global_this__: __global_this__$1,
    isBrowser: isBrowser,
    targetEnv: targetEnv,
    __esModule: true
};

class ModuleSystem {
    constructor(){
        this.dynamicResources = [];
        this.modules = {};
        this.cache = {};
        this.publicPaths = [];
        this.dynamicModuleResourcesMap = {};
        this.resourceLoader = new ResourceLoader(this, this.publicPaths);
        this.pluginContainer = new FarmRuntimePluginContainer([]);
        this.targetEnv = targetEnv;
        this.externalModules = {};
        this.reRegisterModules = false;
    }
    require(moduleId, isCJS = false) {
        if (this.cache[moduleId]) {
            const shouldSkip = this.pluginContainer.hookBail("readModuleCache", this.cache[moduleId]);
            if (!shouldSkip) {
                const cachedModule = this.cache[moduleId];
                return cachedModule.initializer || cachedModule.exports;
            }
        }
        const initializer = this.modules[moduleId];
        if (!initializer) {
            if (this.externalModules[moduleId]) {
                const exports = this.externalModules[moduleId];
                if (isCJS) {
                    return exports.default || exports;
                }
                return exports;
            }
            if ((this.targetEnv === "node" || !isBrowser) && nodeRequire) {
                const externalModule = nodeRequire(moduleId);
                return externalModule;
            }
            this.pluginContainer.hookSerial("moduleNotFound", moduleId);
            console.debug(`[Farm] Module "${moduleId}" is not registered`);
            return {};
        }
        const module = new Module(moduleId, this.require.bind(this));
        module.resource_pot = initializer.__farm_resource_pot__;
        this.pluginContainer.hookSerial("moduleCreated", module);
        this.cache[moduleId] = module;
        if (!__global_this__$1.require) {
            __global_this__$1.require = this.require.bind(this);
        }
        const result$3 = initializer(module, module.exports, this.require.bind(this), this.farmDynamicRequire.bind(this));
        if (result$3 && result$3 instanceof Promise) {
            module.initializer = result$3.then(()=>{
                this.pluginContainer.hookSerial("moduleInitialized", module);
                module.initializer = undefined;
                return module.exports;
            });
            return module.initializer;
        } else {
            this.pluginContainer.hookSerial("moduleInitialized", module);
            return module.exports;
        }
    }
    farmDynamicRequire(moduleId) {
        if (this.modules[moduleId]) {
            const exports$1 = this.require(moduleId);
            if (exports$1.__farm_async) {
                return exports$1.default;
            } else {
                return Promise.resolve(exports$1);
            }
        }
        return this.loadDynamicResources(moduleId);
    }
    loadDynamicResourcesOnly(moduleId, force = false) {
        const resources = this.dynamicModuleResourcesMap[moduleId].map((index)=>this.dynamicResources[index]);
        if (!resources || resources.length === 0) {
            throw new Error(`Dynamic imported module "${moduleId}" does not belong to any resource`);
        }
        if (force) {
            this.clearCache(moduleId);
        }
        return Promise.all(resources.map((resource)=>{
            if (force) {
                const resourceLoaded = this.resourceLoader.isResourceLoaded(resource.path);
                this.resourceLoader.setLoadedResource(resource.path, false);
                if (resourceLoaded) {
                    return this.resourceLoader.load({
                        ...resource,
                        path: `${resource.path}?t=${Date.now()}`
                    });
                }
            }
            return this.resourceLoader.load(resource);
        }));
    }
    loadDynamicResources(moduleId, force = false) {
        const resources$1 = this.dynamicModuleResourcesMap[moduleId].map((index)=>this.dynamicResources[index]);
        return this.loadDynamicResourcesOnly(moduleId, force).then(()=>{
            if (resources$1.every((resource)=>resource.type !== 0)) {
                return;
            }
            if (!this.modules[moduleId]) {
                throw new Error(`Dynamic imported module "${moduleId}" is not registered.`);
            }
            const result$4 = this.require(moduleId);
            if (result$4.__farm_async) {
                return result$4.default;
            } else {
                return result$4;
            }
        }).catch((err)=>{
            console.error(`[Farm] Error loading dynamic module "${moduleId}"`, err);
            throw err;
        });
    }
    register(moduleId, initializer) {
        if (this.modules[moduleId] && !this.reRegisterModules) {
            console.warn(`Module "${moduleId}" has registered! It should not be registered twice`);
            return;
        }
        this.modules[moduleId] = initializer;
    }
    update(moduleId, init) {
        this.modules[moduleId] = init;
        this.clearCache(moduleId);
    }
    delete(moduleId) {
        if (this.modules[moduleId]) {
            this.clearCache(moduleId);
            delete this.modules[moduleId];
            return true;
        } else {
            return false;
        }
    }
    getModuleUrl(moduleId) {
        const publicPath$1 = this.publicPaths[0] ?? "";
        if (isBrowser) {
            const url$1 = `${window.location.protocol}//${window.location.host}${publicPath$1.endsWith("/") ? publicPath$1.slice(0, -1) : publicPath$1}/${this.modules[moduleId].__farm_resource_pot__}`;
            return url$1;
        } else {
            return this.modules[moduleId].__farm_resource_pot__;
        }
    }
    getCache(moduleId) {
        return this.cache[moduleId];
    }
    clearCache(moduleId) {
        if (this.cache[moduleId]) {
            delete this.cache[moduleId];
            return true;
        } else {
            return false;
        }
    }
    setInitialLoadedResources(resources) {
        for (const resource of resources){
            this.resourceLoader.setLoadedResource(resource);
        }
    }
    setDynamicModuleResourcesMap(dynamicResources, dynamicModuleResourcesMap) {
        this.dynamicResources = dynamicResources;
        this.dynamicModuleResourcesMap = dynamicModuleResourcesMap;
    }
    setPublicPaths(publicPaths) {
        this.publicPaths = publicPaths;
        this.resourceLoader.publicPaths = this.publicPaths;
    }
    setPlugins(plugins) {
        this.pluginContainer.plugins = plugins;
    }
    addPlugin(plugin) {
        if (this.pluginContainer.plugins.every((p)=>p.name !== plugin.name)) {
            this.pluginContainer.plugins.push(plugin);
        }
    }
    removePlugin(pluginName) {
        this.pluginContainer.plugins = this.pluginContainer.plugins.filter((p)=>p.name !== pluginName);
    }
    setExternalModules(externalModules) {
        Object.assign(this.externalModules, externalModules || {});
    }
    bootstrap() {
        this.pluginContainer.hookSerial("bootstrap", this);
    }
}

__farm_global_this__.__farm_module_system__ = (function() {
    const moduleSystem = new ModuleSystem();
    return function() {
        return moduleSystem;
    };
})()();
window['361ed0f21b388038be2dd935ad449941'].__farm_module_system__.setPlugins([
    index_js_default
]);
})());(function(_){var filename = ((function(){var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;return typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.src || new URL("entry_8890.js", document.baseURI).href})());for(var r in _){_[r].__farm_resource_pot__=filename;window['361ed0f21b388038be2dd935ad449941'].__farm_module_system__.register(r,_[r])}})({"2055eeaa":function  (module, exports, farmRequire, farmDynamicRequire) {
    module._m(exports);
    var _f_dotnet_asset_test = module.i(farmRequire("7155d57c"));
    globalThis.__spikeWasmUrl = module.f(_f_dotnet_asset_test);
}
,
"7155d57c":function  (module, exports, farmRequire, farmDynamicRequire) {
    module._m(exports);
    exports.default = "/assets/Library.9227d2af-7a0b04.wasm";
}
,});window['361ed0f21b388038be2dd935ad449941'].__farm_module_system__.setInitialLoadedResources([]);window['361ed0f21b388038be2dd935ad449941'].__farm_module_system__.setDynamicModuleResourcesMap([],{  });var farmModuleSystem = window['361ed0f21b388038be2dd935ad449941'].__farm_module_system__;farmModuleSystem.bootstrap();var entry = farmModuleSystem.require("2055eeaa");
//# sourceMappingURL=entry.js.map