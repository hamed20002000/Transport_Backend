export enum LoadingOrderStatus {
  Draft = 0,
  Issued = 1,
  Used = 2,
  Cancelled = 3,
  Expired = 4,
}

export enum DeliveryProofMethod {
  OTP = 0,
  Signature = 1,
  Photo = 2,
  QR = 3,
  Manual = 4,
}