export const APP_ENVS = {
  test: 'test',
  local: 'local',
  prod: 'prod',
};

export const env = {
  APP_ENVS,
  /**
   * Will be re-set in main.setup.ts
   */
  ROOT_DIR: '',
};

export * from './kafka.constant';
export * from './message.constant';
export * from './timezone.constant';
