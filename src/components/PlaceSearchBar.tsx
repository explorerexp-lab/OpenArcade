import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import type { LatLngLiteral } from '../game/geoEngine';

export interface CuratedCitySector {
  id: string;
  label: string;
  region: string;
  center: LatLngLiteral;
}

export const CURATED_SECTORS: CuratedCitySector[] = [
  {
    id: 'sf-embarcadero',
    label: 'San Francisco',
    region: 'Embarcadero & Downtown',
    center: { lat: 37.7955, lng: -122.3937 },
  },
  {
    id: 'tokyo-shibuya',
    label: 'Tokyo',
    region: 'Shibuya & Harajuku',
    center: { lat: 35.6595, lng: 139.7004 },
  },
  {
    id: 'london-westminster',
    label: 'London',
    region: 'Westminster & South Bank',
    center: { lat: 51.5033, lng: -0.1195 },
  },
  {
    id: 'paris-louvre',
    label: 'Paris',
    region: 'Louvre & Tuileries',
    center: { lat: 48.8606, lng: 2.3376 },
  },
  {
    id: 'nyc-midtown',
    label: 'New York',
    region: 'Bryant Park & Midtown',
    center: { lat: 40.7536, lng: -73.9832 },
  },
  {
    id: 'zurich-oldtown',
    label: 'Zurich',
    region: 'Altstadt & Limmat',
    center: { lat: 47.3717, lng: 8.5422 },
  },
];

interface PlaceSearchBarProps {
  activeSectorName: string;
  onSelectDestination: (center: LatLngLiteral, label: string) => void;
  compact?: boolean;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|QuotaExceeded|REQUEST_DENIED/i.test(msg);
}

export const PlaceSearchBar: React.FC<PlaceSearchBarProps> = ({
  activeSectorName,
  onSelectDestination,
  compact = false,
}) => {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  useEffect(() => {
    if (!placesLib) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        setError(null);
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res.suggestions.slice(0, 5));
        }
      } catch (err) {
        if (!cancelled) {
          setSuggestions([]);
          if (isQuotaError(err)) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          setError('Search unavailable right now. Pick a quick city or click the map.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, query]);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!suggestion.placePrediction) return;
    try {
      setSearching(true);
      setError(null);
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'location', 'formattedAddress'],
      });
      const loc = place.location;
      if (loc) {
        const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
        const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
        const label =
          place.displayName ||
          suggestion.placePrediction.mainText?.text ||
          suggestion.placePrediction.text.text ||
          'Selected Sector';
        onSelectDestination({ lat, lng }, label);
      }
      setQuery('');
      resetSession();
    } catch (err) {
      if (isQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      setError('Could not load coordinates for that place.');
    } finally {
      setSearching(false);
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onSelectDestination(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          'My Live Sector'
        );
      },
      () => {
        setLocating(false);
        setError('Location access was denied or unavailable. Search any city above.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="space-y-3">
      {/* Search Input + Explicit GPS Consent Button */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#9aa5b8]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any city, street, or landmark..."
            aria-label="Search real-world city or landmark"
            className="w-full border border-[#f2ece1]/20 bg-[#0d121c] py-2.5 pr-9 pl-9 text-sm text-[#f2ece1] placeholder-[#7d889c] focus:border-[#e5a94c] focus:outline-none"
          />
          {searching && (
            <Loader2
              className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-[#e5a94c]"
              aria-hidden="true"
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={locating}
          aria-label="Use my GPS location"
          title="Drop into your current GPS location"
          className="flex h-[42px] shrink-0 cursor-pointer items-center gap-1.5 border border-[#f2ece1]/20 bg-[#151d2c] px-3 text-xs font-semibold text-[#f2ece1] transition hover:border-[#e5a94c] hover:text-[#f5d18c] disabled:opacity-60 whitespace-nowrap"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e5a94c]" />
          ) : (
            <Crosshair className="h-3.5 w-3.5 text-[#e5a94c]" />
          )}
          <span>My GPS</span>
        </button>

        {/* Autocomplete Dropdown */}
        {suggestions.length > 0 && (
          <ul
            role="listbox"
            className="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto border border-[#e5a94c]/40 bg-[#0e1420] shadow-2xl"
          >
            {suggestions.map((s, idx) => (
              <li key={s.placePrediction?.placeId || idx}>
                <button
                  type="button"
                  onClick={() => void handleSelectSuggestion(s)}
                  className="flex w-full cursor-pointer items-start gap-2.5 border-b border-[#f2ece1]/8 px-3 py-2.5 text-left text-xs text-[#ece5d8] transition hover:bg-[#1a2436]"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e5a94c]" />
                  <span className="truncate">{s.placePrediction?.text.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs text-amber-300">{error}</p>}

      {/* Curated World City Sectors */}
      <div className={compact ? 'flex flex-wrap gap-1.5' : 'grid grid-cols-2 gap-1.5 sm:grid-cols-3'}>
        {CURATED_SECTORS.map((city) => {
          const active = activeSectorName.toLowerCase().includes(city.label.toLowerCase());
          return (
            <button
              key={city.id}
              type="button"
              onClick={() => onSelectDestination(city.center, `${city.label} · ${city.region}`)}
              className={`cursor-pointer border px-2.5 py-2 text-left transition whitespace-nowrap ${
                active
                  ? 'border-[#e5a94c] bg-[#e5a94c]/18 text-[#f7dca2]'
                  : 'border-[#f2ece1]/14 bg-[#121927] text-[#d5cdc0] hover:border-[#e5a94c]/60 hover:text-white'
              }`}
            >
              <div className="text-xs font-semibold">{city.label}</div>
              {!compact && (
                <div className="truncate text-[11px] text-[#95a0b3]">{city.region}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
