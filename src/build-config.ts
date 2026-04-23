/**
 * Build-time configuration. In release builds the pkg bundler / CI pipeline
 * replaces BUILD_TYPE="prod" and the prod backend URL is locked in —
 * the packaged binary ignores XFLOW_BACKEND_URL + config.yaml overrides.
 * In dev builds (npm run dev) both sources are honored for local testing.
 *
 * How to bake for prod:
 *   BUILD_TYPE=prod npm run build && npm run package
 *
 * Why locked in prod: an agent shipped to restaurant customers should not
 * be silently pointable at attacker-controlled backends via env var or an
 * editable YAML file that the customer's IT dienstleister might change.
 */
export type BuildType = 'dev' | 'prod';

export const BUILD_TYPE: BuildType =
  (process.env.BUILD_TYPE as BuildType) === 'prod' ? 'prod' : 'dev';

export const PROD_BACKEND_URL = 'https://api.customrflow.app';

export const isProdBuild = (): boolean => BUILD_TYPE === 'prod';
