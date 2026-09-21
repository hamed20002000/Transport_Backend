export const TelegramCallback = {
  MainMenu: 'main_menu',

  BuyAccount: 'buy_account',
  RenewSubscription: 'renew_subscription',
  MySubscription: 'my_subscription',
  Support: 'support',
  CancelPurchase: 'cancel_purchase',

  DriverSearchLoads: 'driver_search_loads',
  DriverLoadRequests: 'driver_load_requests',
  DriverActiveTrip: 'driver_active_trip',
  DriverReturnLoads: 'driver_return_loads',

  CompanyCreateLoad: 'company_create_load',
  CompanyLoads: 'company_loads',
  CompanyDriverRequests: 'company_driver_requests',
  CompanyActiveTrips: 'company_active_trips',

  BrokerSearchLoads: 'broker_search_loads',
  BrokerLoads: 'broker_loads',
  BrokerDrivers: 'broker_drivers',

  AccountTypePrefix: 'account_type:',
  PlanPrefix: 'plan:',
  RequestLoadPrefix: 'request_load:',
} as const;

export const TelegramCallbackBuilder = {
  accountType(
    accountType: string,
  ): string {
    return `${TelegramCallback.AccountTypePrefix}${accountType}`;
  },

  plan(
    planId: string,
  ): string {
    return `${TelegramCallback.PlanPrefix}${planId}`;
  },

  requestLoad(
    loadId: string,
  ): string {
    return `${TelegramCallback.RequestLoadPrefix}${loadId}`;
  },
};