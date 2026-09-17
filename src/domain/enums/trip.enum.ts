export enum TripExpenseType {
  Toll = 0,
  Parking = 1,
  Repair = 2,
  Loading = 3,
  Unloading = 4,
  Food = 5,
  Accommodation = 6,
  Other = 7,
}

export enum TripStatus {
  Created = 0,

  ToPickup = 1,

  AtPickup = 2,

  Loading = 3,

  Loaded = 4,

  InTransit = 5,

  AtDestination = 6,

  Delivered = 7,

  Completed = 8,

  Cancelled = 9,

  Failed = 10,
}