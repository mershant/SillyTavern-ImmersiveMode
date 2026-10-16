const EXTENSION_ROUTE = '/scripts/extensions/';


export function extensionNameFromModuleUrl(moduleUrl) {
  const pathname = new URL(moduleUrl).pathname;
  const routeIndex = pathname.indexOf(EXTENSION_ROUTE);
  if (routeIndex < 0) {
    throw new Error('The module is outside the SillyTavern extension route.');
  }

  const relativePath = decodeURIComponent(pathname.slice(routeIndex + EXTENSION_ROUTE.length));
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('The installed extension folder could not be determined.');
  }

  segments.pop();
  return segments.join('/');
}
