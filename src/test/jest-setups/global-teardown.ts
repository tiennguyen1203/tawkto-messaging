import { DatabaseContainer } from '../database-container';

const globalTeardown = async () => {
  await DatabaseContainer.clear();
};

export default globalTeardown;
