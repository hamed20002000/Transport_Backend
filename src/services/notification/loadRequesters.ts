export const DRIVER_ROLE = 'DRIVER';
export const BROKER_ROLE = 'BROKER';

/**
 * Who sees the open loads and requests them: drivers, and brokers (واسط). A broker only requests: active trips,
 * location and delivery stay with drivers; the company sees a broker's request marked as such.
 */
export const LOAD_REQUESTER_ROLES = [DRIVER_ROLE, BROKER_ROLE];

export const isBrokerOnly = (roles: Array<string | null | undefined>) => roles.includes(BROKER_ROLE) && !roles.includes(DRIVER_ROLE);
