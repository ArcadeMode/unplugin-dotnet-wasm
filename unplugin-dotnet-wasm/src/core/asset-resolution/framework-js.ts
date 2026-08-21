import { FRAMEWORK_JS_REGEX } from '../constants';
import { toPosixPath } from '../path-utils';

/** True for `_framework/dotnet*.js` / `blazor.webassembly.js` on virtual or OS paths. */
export function isFrameworkJsPath(path: string): boolean {
  const posix = toPosixPath(path);
  return FRAMEWORK_JS_REGEX.test(posix.startsWith('/') ? posix : `/${posix}`);
}
