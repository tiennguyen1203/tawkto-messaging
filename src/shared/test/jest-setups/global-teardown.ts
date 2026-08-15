import { DatabaseContainer } from '../database-container';
import { SearchContainer } from '../search-container';

const globalTeardown = async () => {
  await Promise.all([DatabaseContainer.clear(), SearchContainer.clear()]);
};

export default globalTeardown;
