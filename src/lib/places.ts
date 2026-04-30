export const LOCATION_COMBOBOX_THRESHOLD = 5;

export type PlaceResult = {
  placeId: number;
  displayName: string;
  lat: string;
  lon: string;
  address: {
    countryCode?: string;
    region?: string;
    locality?: string;
    postalCode?: string;
    street?: string;
  };
};
