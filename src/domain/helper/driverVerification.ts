/**
 * A driver that signs up on its own is checked by a parent company before it works (AccountVerificationService), like
 * a broker or a transport company. DRIVER_VERIFICATION=off lets every driver through unchecked (its profile still
 * asks for its name and papers).
 */
export const driverVerificationOn = (): boolean => process.env.DRIVER_VERIFICATION !== 'off';

/**
 * A driver's request needs the fields of its kind filled in its profile first (DriverProfileService.missingForRequest:
 * an international one's company, a domestic one's insurance). DRIVER_REQUEST_FIELDS=off lets the request go without.
 */
export const driverRequestFieldsOn = (): boolean => process.env.DRIVER_REQUEST_FIELDS !== 'off';
