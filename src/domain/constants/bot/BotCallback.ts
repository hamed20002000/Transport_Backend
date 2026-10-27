export const BotCallback = {
  MainMenu: 'main_menu',
  CompanyProfile: 'company_profile',

  BuyAccount: 'buy_account',
  PaymentStatus: 'payment_status',
  RenewSubscription: 'renew_subscription',
  MySubscription: 'my_subscription',
  Support: 'support',
  CancelPurchase: 'cancel_purchase',

  DriverSearchLoads: 'driver_search_loads',
  DriverLoadRequests: 'driver_load_requests',
  DriverActiveTrip: 'driver_active_trip',
  DriverReturnLoads: 'driver_return_loads',
  DriverMyLocation: 'driver_my_location',
  DriverSendLocation: 'driver_send_location',
  // وضعیت صف مرزهای زمینی (BorderDialog)
  Borders: 'borders',
  // متنی یا تصویری بودن اعلان بارها (CargoDisplayDialog)
  CargoDisplay: 'cargo_display',

  CompanyCreateLoad: 'company_create_load',
  CompanyLoads: 'company_loads',
  CompanyDriverRequests: 'company_driver_requests',
  CompanyActiveTrips: 'company_active_trips',
  CompanyChannels: 'company_channels',
  // خرید بخش‌های پنل شرکت (CompanyFeatureDialog)
  CompanyFeatures: 'company_features',

  BrokerSearchLoads: 'broker_search_loads',
  BrokerLoads: 'broker_loads',

  // کارخانه (FactoryDialog): فقط ثبت بار برای شرکت‌هایی که دعوتش کرده‌اند
  FactoryCreateLoad: 'factory_create_load',
  FactoryExcel: 'factory_excel',
  FactoryLoads: 'factory_loads',

  RegisterAccountTypePrefix: 'register_account_type:',
  AccountTypePrefix: 'account_type:',
  PlanPrefix: 'plan:',
  RequestLoadPrefix: 'request_load:',
} as const;

export const BotCallbackBuilder = {
  accountType(
    accountType: string,
  ): string {
    return `${BotCallback.AccountTypePrefix}${accountType}`;
  },

  plan(
    planId: string,
  ): string {
    return `${BotCallback.PlanPrefix}${planId}`;
  },

  requestLoad(
    loadId: string,
  ): string {
    return `${BotCallback.RequestLoadPrefix}${loadId}`;
  },
};
