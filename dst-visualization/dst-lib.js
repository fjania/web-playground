'use strict';

// ── DST Shared Library ─────────────────────────────────────
// Computation, city data, and formatting for DST visualizations.
// Loaded as a regular <script> (not module) so file:// works.

// ── Constants ──────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];

const US_DST = { start: 70, end: 309 };
const EU_DST = { start: 87, end: 299 };
const AU_DST = { start: 274, end: 91 };
const NZ_DST = { start: 269, end: 91 };
const OLD_US_DST = { start: 91, end: 299 }; // Pre-2005: 1st Sun Apr → last Sun Oct

const CITIES = [
  { group: 'Arctic & Subarctic', cities: [
    { name: 'Tromsø', country: 'Norway', lat: 69.65, lng: 18.96, dst: EU_DST },
    { name: 'Fairbanks', country: 'Alaska', lat: 64.84, lng: -147.72, dst: US_DST },
    { name: 'Reykjavik', country: 'Iceland', lat: 64.13, lng: -21.90, dst: null },
    { name: 'Anchorage', country: 'Alaska', lat: 61.22, lng: -149.90, dst: US_DST },
    { name: 'Helsinki', country: 'Finland', lat: 60.17, lng: 24.94, dst: EU_DST },
    { name: 'Stockholm', country: 'Sweden', lat: 59.33, lng: 18.07, dst: EU_DST },
    { name: 'Oslo', country: 'Norway', lat: 59.91, lng: 10.75, dst: EU_DST },
  ]},
  { group: 'Northern Europe', cities: [
    { name: 'Moscow', country: 'Russia', lat: 55.76, lng: 37.62, dst: null },
    { name: 'Copenhagen', country: 'Denmark', lat: 55.68, lng: 12.57, dst: EU_DST },
    { name: 'Edinburgh', country: 'Scotland', lat: 55.95, lng: -3.19, dst: EU_DST },
    { name: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.41, dst: EU_DST },
    { name: 'London', country: 'UK', lat: 51.51, lng: -0.13, dst: EU_DST },
    { name: 'Paris', country: 'France', lat: 48.86, lng: 2.35, dst: EU_DST },
  ]},
  { group: 'Mid-Latitude North', cities: [
    { name: 'Seattle', country: 'USA', lat: 47.61, lng: -122.33, dst: US_DST },
    { name: 'Montreal', country: 'Canada', lat: 45.50, lng: -73.57, dst: US_DST },
    { name: 'Boston', country: 'USA', lat: 42.36, lng: -71.06, dst: US_DST },
    { name: 'New York', country: 'USA', lat: 40.71, lng: -74.01, dst: US_DST },
    { name: 'Madrid', country: 'Spain', lat: 40.42, lng: -3.70, dst: EU_DST },
    { name: 'Lisbon', country: 'Portugal', lat: 38.72, lng: -9.14, dst: EU_DST },
    { name: 'Tokyo', country: 'Japan', lat: 35.68, lng: 139.69, dst: null },
    { name: 'Chapel Hill', country: 'USA', lat: 35.91, lng: -79.05, dst: US_DST },
    { name: 'Los Angeles', country: 'USA', lat: 34.05, lng: -118.24, dst: US_DST },
  ]},
  { group: 'Subtropical', cities: [
    { name: 'Austin', country: 'USA', lat: 30.27, lng: -97.74, dst: US_DST },
    { name: 'Cairo', country: 'Egypt', lat: 30.04, lng: 31.24, dst: null },
    { name: 'New Delhi', country: 'India', lat: 28.61, lng: 77.21, dst: null },
    { name: 'Dubai', country: 'UAE', lat: 25.20, lng: 55.27, dst: null },
    { name: 'Honolulu', country: 'Hawaii', lat: 21.31, lng: -157.86, dst: null },
    { name: 'Mumbai', country: 'India', lat: 19.08, lng: 72.88, dst: null },
    { name: 'Mexico City', country: 'Mexico', lat: 19.43, lng: -99.13, dst: null },
  ]},
  { group: 'Tropical', cities: [
    { name: 'San José', country: 'Costa Rica', lat: 9.93, lng: -84.08, dst: null },
    { name: 'Lagos', country: 'Nigeria', lat: 6.52, lng: 3.38, dst: null },
    { name: 'Singapore', country: 'Singapore', lat: 1.35, lng: 103.82, dst: null },
    { name: 'Quito', country: 'Ecuador', lat: -0.18, lng: -78.47, dst: null },
    { name: 'Nairobi', country: 'Kenya', lat: -1.29, lng: 36.82, dst: null },
  ]},
  { group: 'Southern Hemisphere', cities: [
    { name: 'Lima', country: 'Peru', lat: -12.05, lng: -77.04, dst: null },
    { name: 'São Paulo', country: 'Brazil', lat: -23.55, lng: -46.63, dst: null },
    { name: 'Buenos Aires', country: 'Argentina', lat: -34.60, lng: -58.38, dst: null },
    { name: 'Cape Town', country: 'South Africa', lat: -33.93, lng: 18.42, dst: null },
    { name: 'Sydney', country: 'Australia', lat: -33.87, lng: 151.21, dst: AU_DST },
    { name: 'Auckland', country: 'New Zealand', lat: -36.85, lng: 174.76, dst: NZ_DST },
    { name: 'Christchurch', country: 'New Zealand', lat: -43.53, lng: 172.64, dst: NZ_DST },
    { name: 'Ushuaia', country: 'Argentina', lat: -54.80, lng: -68.30, dst: null },
  ]},
];

// ── Solar Calculator ───────────────────────────────────────

class SolarCalculator {
  static #DEG2RAD = Math.PI / 180;

  static declination(dayOfYear) {
    return 23.45 * Math.sin(2 * Math.PI / 365 * (dayOfYear - 81));
  }

  static daylightForDay(dayOfYear, latitude) {
    const decl = this.declination(dayOfYear) * this.#DEG2RAD;
    const lat = latitude * this.#DEG2RAD;
    const cosHA = -Math.tan(lat) * Math.tan(decl);

    if (cosHA < -1) return { sunrise: 0, sunset: 1440, type: 'midnight-sun' };
    if (cosHA > 1)  return { sunrise: 720, sunset: 720, type: 'polar-night' };

    const ha = Math.acos(cosHA);
    const halfDay = (ha / this.#DEG2RAD) * 4;
    return { sunrise: 720 - halfDay, sunset: 720 + halfDay, type: 'normal' };
  }

  static computeYear(latitude) {
    const days = [];
    for (let d = 1; d <= 365; d++) days.push(this.daylightForDay(d, latitude));
    return days;
  }
}

// ── Formatting Helpers ─────────────────────────────────────

function dayOfYearToDate(doy) {
  let remaining = doy;
  for (let m = 0; m < 12; m++) {
    if (remaining <= DAYS_IN_MONTH[m]) return { month: m, day: remaining };
    remaining -= DAYS_IN_MONTH[m];
  }
  return { month: 11, day: 31 };
}

function formatDate(doy) {
  const { month, day } = dayOfYearToDate(doy);
  return `${MONTHS[month]} ${day}`;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatHours(totalMinutes) {
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.round(Math.abs(totalMinutes) % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function latitudeString(lat) {
  const abs = Math.abs(lat).toFixed(1);
  return `${abs}\u00b0 ${lat >= 0 ? 'N' : 'S'}`;
}

function monthStarts() {
  const starts = [1];
  let acc = 0;
  for (let m = 0; m < 11; m++) { acc += DAYS_IN_MONTH[m]; starts.push(acc + 1); }
  return starts;
}

// ── DST Computation Helpers ────────────────────────────────

function isDstDay(d, start, end) {
  if (start == null || end == null) return false;
  if (start <= end) return d >= start && d <= end;
  return d >= start || d <= end; // wraps year boundary
}

function calcWakingDark(rise, set, wake, sleep) {
  let dark = 0;
  if (rise > wake) dark += rise - wake;
  if (set < sleep) dark += sleep - set;
  return dark;
}

function calcSleepingLight(rise, set, wake, sleep) {
  let light = 0;
  if (rise < wake) light += wake - rise;
  if (set > sleep) light += set - sleep;
  return light;
}

function annualStats(latitude, dstStart, dstEnd, wake = 360, sleep = 1320) {
  const yearData = SolarCalculator.computeYear(latitude);
  let wakingDark = 0, sleepingLight = 0;
  let wakingDarkNoDST = 0, sleepingLightNoDST = 0;
  const dstEnabled = dstStart != null && dstEnd != null;

  for (let d = 1; d <= 365; d++) {
    const base = yearData[d - 1];
    let rise = base.sunrise, set = base.sunset;

    wakingDarkNoDST += calcWakingDark(rise, set, wake, sleep);
    sleepingLightNoDST += calcSleepingLight(rise, set, wake, sleep);

    if (dstEnabled && isDstDay(d, dstStart, dstEnd)) {
      rise = Math.max(0, rise + 60);
      set = Math.min(1440, set + 60);
    }

    wakingDark += calcWakingDark(rise, set, wake, sleep);
    sleepingLight += calcSleepingLight(rise, set, wake, sleep);
  }

  const wastedNoDST = wakingDarkNoDST + sleepingLightNoDST;
  const wasted = wakingDark + sleepingLight;

  return {
    wakingDark, sleepingLight,
    wakingDarkNoDST, sleepingLightNoDST,
    savings: wastedNoDST - wasted,
  };
}

// Stats for permanent DST (shift ALL days by +60, no toggle)
function annualStatsPermanentDST(latitude, wake = 360, sleep = 1320) {
  const yearData = SolarCalculator.computeYear(latitude);
  let wakingDark = 0, sleepingLight = 0;

  for (let d = 1; d <= 365; d++) {
    const base = yearData[d - 1];
    const rise = Math.max(0, base.sunrise + 60);
    const set = Math.min(1440, base.sunset + 60);
    wakingDark += calcWakingDark(rise, set, wake, sleep);
    sleepingLight += calcSleepingLight(rise, set, wake, sleep);
  }

  return { wakingDark, sleepingLight };
}

// Reference cities for latitude slider labels
const LATITUDE_REFS = [
  { lat: 0, name: 'Equator' },
  { lat: 10, name: 'Costa Rica' },
  { lat: 20, name: 'Hawaii' },
  { lat: 30, name: 'Cairo' },
  { lat: 35, name: 'Tokyo' },
  { lat: 40, name: 'New York' },
  { lat: 45, name: 'Montreal' },
  { lat: 48, name: 'Paris' },
  { lat: 52, name: 'Berlin' },
  { lat: 55, name: 'Edinburgh' },
  { lat: 60, name: 'Helsinki' },
  { lat: 65, name: 'Fairbanks' },
  { lat: 70, name: 'Tromsø' },
];

function nearestCityForLat(lat) {
  let best = LATITUDE_REFS[0];
  let bestDist = Infinity;
  for (const ref of LATITUDE_REFS) {
    const dist = Math.abs(ref.lat - lat);
    if (dist < bestDist) { bestDist = dist; best = ref; }
  }
  return best.name;
}
