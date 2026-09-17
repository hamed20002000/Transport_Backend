export enum LoadStatus {
  Draft = 0,
  Published = 1,
  DriverRequested = 2,
  Assigned = 3,
  InTransit = 4,
  Delivered = 5,
  Cancelled = 6,
  Expired = 7,
}

export enum LoadOfferStatus {
  Pending = 0,
  Seen = 1,
  Accepted = 2,
  Rejected = 3,
  Expired = 4,
  Cancelled = 5,
}
export enum DriverLoadRequestStatus {
  Pending = 0,
  Accepted = 1,
  Rejected = 2,
  Cancelled = 3,
  Expired = 4,
}
export enum LoadAssignmentStatus {
  Assigned = 0,
  Confirmed = 1,
  Cancelled = 2,
  Started = 3,
  Completed = 4,
}