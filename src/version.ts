declare const __PACKAGE_VERSION__: string | undefined;

/** This package's version, injected from package.json at build time. */
export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '0.0.0-test';
