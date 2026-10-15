import type { Validator } from "./api";

type LocatedValidator = Validator & {
  location: NonNullable<Validator["location"]> & { lat: number; lon: number };
};

export function hasMapLocation(v: Validator): v is LocatedValidator {
  const l = v.location;
  return l !== null && typeof l.lat === "number" && typeof l.lon === "number"
    && Number.isFinite(l.lat) && Number.isFinite(l.lon)
    && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180;
}

export function mapCoverage(validators: Validator[]) {
  const placed = validators.filter(hasMapLocation);
  const unplaced = validators.filter((v) => !hasMapLocation(v));
  return {
    placed,
    unplaced,
    countries: new Set(placed.map((v) => v.location.country_code ?? v.location.country).filter(Boolean)).size,
    cities: new Set(placed.filter((v) => v.location.city).map((v) =>
      JSON.stringify([v.location.country_code ?? v.location.country, v.location.city]),
    )).size,
  };
}
