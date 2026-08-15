import { UTC_TIMEZONE } from '../../common/constants';
import { DatabaseContainer } from '../database-container';
import { SearchContainer } from '../search-container';

const globalSetup = async () => {
  process.env.TZ = UTC_TIMEZONE;

  // Concurrently: Elasticsearch is a JVM and takes far longer to come up than
  // MongoDB, so the run should pay the slower of the two rather than the sum.
  await Promise.all([DatabaseContainer.init(), SearchContainer.init()]);
};

export default globalSetup;
