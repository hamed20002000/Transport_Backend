/**
 * A broker (واسط) the parent company has approved works under the admin's broker policy: the company limit and the
 * request packages (BrokerAccessService). BROKERS_OPEN=on lifts those for every approved broker (no companies to
 * pick, nothing to buy); the verification itself always applies (AccountVerificationService).
 */
export const brokersOpen = (): boolean => process.env.BROKERS_OPEN === 'on';
