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

// A place from iNaturalist's places/autocomplete endpoint, normalized for use
// by /api/inat-places and its callers. iNat place ids are distinct from the
// Nominatim place ids in PlaceResult, and only iNat ids work with
// observations/species_counts (issue #9).
export type InatPlace = {
  id: number;
  name: string;
  displayName: string;
};
