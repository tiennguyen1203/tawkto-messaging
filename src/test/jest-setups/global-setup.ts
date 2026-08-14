import { UTC_TIMEZONE } from '../../common/constants';
import { DatabaseContainer } from '../database-container';

const globalSetup = async () => {
  process.env.TZ = UTC_TIMEZONE;

  await DatabaseContainer.init();
};

export default globalSetup;
